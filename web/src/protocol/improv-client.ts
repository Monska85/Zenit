// SPDX-License-Identifier: GPL-3.0-or-later

// The client side of Improv Wi-Fi Serial: the board's state, its device info, a scan of the networks it sees, and
// the WiFi settings. One request at a time. The password is only ever in the bytes of the frame, which are wiped after
// they are sent; it is in no log, no error and no storage.

import {
  ImprovErrorCode,
  ImprovState,
  RpcCommandCode,
  readBoardFrame,
  rpcFrame,
  wifiSettingsArgs,
  type BoardFrame,
} from "./improv";
import type { ImprovLink } from "./transport";

export type ImprovFailure =
  /** The board did not understand the request. */
  | "invalid_rpc"
  | "unknown_rpc"
  /** The board could not join the network (wrong password, out of range). */
  | "unable_to_connect"
  | "timeout"
  | "busy"
  | "link";

export class ImprovError extends Error {
  constructor(
    readonly failure: ImprovFailure,
    message: string,
  ) {
    super(message);
  }
}

export interface ImprovNetwork {
  ssid: string;
  rssi: number;
  secure: boolean;
}

export interface ImprovDeviceInfo {
  firmwareName: string;
  firmwareVersion: string;
  chip: string;
  hostname: string;
}

export interface ImprovTimeouts {
  state: number;
  info: number;
  scan: number;
  provision: number;
}

/** The board scans for 15 s and connects for up to 30 s; the client waits a little longer than each. */
export const IMPROV_TIMEOUTS: ImprovTimeouts = { state: 3000, info: 3000, scan: 20_000, provision: 35_000 };
/** After the board says `provisioned` the empty result follows at once; without it the client goes on after this long. */
const RESULT_GRACE_MS = 2000;
export const MAX_NETWORKS = 16;

const encoder = new TextEncoder();

interface Operation {
  /** Returns true when the operation is finished. */
  handle(frame: BoardFrame): boolean;
  fail(error: ImprovError): void;
  timer: ReturnType<typeof setTimeout>;
}

const failureFor = (code: number): ImprovError | null => {
  switch (code) {
    case ImprovErrorCode.InvalidRpc:
      return new ImprovError("invalid_rpc", "the board did not accept those WiFi settings");
    case ImprovErrorCode.UnknownRpc:
      return new ImprovError("unknown_rpc", "the board does not know that request");
    case ImprovErrorCode.UnableToConnect:
      return new ImprovError("unable_to_connect", "the board could not connect to the network");
    default:
      return null;
  }
};

export class ImprovClient {
  /** The last state the board reported: 2 ready, 3 provisioning, 4 provisioned; null until it says. */
  state: number | null = null;
  /** Called when the board reports a state, the one it changed to. */
  onState: ((state: number) => void) | null = null;
  private current: Operation | null = null;
  private readonly timeouts: ImprovTimeouts;

  constructor(
    private readonly link: ImprovLink,
    timeouts: Partial<ImprovTimeouts> = {},
  ) {
    this.timeouts = { ...IMPROV_TIMEOUTS, ...timeouts };
    link.onFrame = (type, data) => this.receive(type, data);
  }

  /** Stops listening and gives up an operation in progress. */
  dispose(): void {
    if (this.link.onFrame !== null) this.link.onFrame = null;
    this.current?.fail(new ImprovError("link", "the connection was closed"));
  }

  private receive(type: number, data: Uint8Array): void {
    const frame = readBoardFrame(type, data);
    if (frame === null) return;
    if (frame.kind === "state") {
      this.state = frame.state;
      this.onState?.(frame.state);
    }
    const operation = this.current;
    if (operation?.handle(frame)) this.settle(operation);
  }

  private settle(operation: Operation): void {
    clearTimeout(operation.timer);
    if (this.current === operation) this.current = null;
  }

  /** Sends `frame` and waits for `handle` to say it is done. */
  private run<T>(
    frame: Uint8Array,
    timeoutMs: number,
    start: (done: (value: T) => void) => Operation["handle"],
  ): Promise<T> {
    if (this.current !== null) {
      frame.fill(0);
      return Promise.reject(new ImprovError("busy", "another WiFi request is running"));
    }
    return new Promise<T>((resolve, reject) => {
      const operation: Operation = {
        handle: () => false,
        fail: (error) => {
          this.settle(operation);
          reject(error);
        },
        timer: setTimeout(() => operation.fail(new ImprovError("timeout", "the board did not answer")), timeoutMs),
      };
      operation.handle = start((value) => {
        this.settle(operation);
        resolve(value);
      });
      this.current = operation;
      this.link
        .sendFrame(frame)
        .catch(() => operation.fail(new ImprovError("link", "the USB connection failed")))
        .finally(() => frame.fill(0));
    });
  }

  /** Asks for the board's state. */
  requestState(): Promise<number> {
    return this.run<number>(rpcFrame(RpcCommandCode.CurrentState), this.timeouts.state, (done) => (frame) => {
      if (frame.kind !== "state") return false;
      done(frame.state);
      return true;
    });
  }

  /** The firmware name and version, the chip and the host name of the board. */
  deviceInfo(): Promise<ImprovDeviceInfo> {
    return this.run<ImprovDeviceInfo>(rpcFrame(RpcCommandCode.DeviceInfo), this.timeouts.info, (done) => (frame) => {
      if (frame.kind !== "result" || frame.command !== RpcCommandCode.DeviceInfo) return false;
      const [firmwareName = "", firmwareVersion = "", chip = "", hostname = ""] = frame.strings;
      done({ firmwareName, firmwareVersion, chip, hostname });
      return true;
    });
  }

  /** The networks the board sees: one name once, strongest first, at most 16. */
  scan(): Promise<ImprovNetwork[]> {
    const found = new Map<string, ImprovNetwork>();
    return this.run<ImprovNetwork[]>(rpcFrame(RpcCommandCode.ScanNetworks), this.timeouts.scan, (done) => (frame) => {
      // The board refused the request (a frame damaged on the line, an RPC it does not know): fail at once
      if (frame.kind === "error") {
        const error = failureFor(frame.error);
        if (error !== null) this.current?.fail(error);
        return false;
      }
      if (frame.kind !== "result" || frame.command !== RpcCommandCode.ScanNetworks) return false;
      if (frame.strings.length === 0) {
        done([...found.values()].sort((a, b) => b.rssi - a.rssi).slice(0, MAX_NETWORKS));
        return true;
      }
      const [ssid, signal, secure] = frame.strings;
      const rssi = Number(signal);
      if (ssid !== undefined && ssid !== "" && Number.isInteger(rssi)) {
        const known = found.get(ssid);
        if (!known || known.rssi < rssi) found.set(ssid, { ssid, rssi, secure: secure === "YES" });
      }
      return false;
    });
  }

  /**
   * Sends the network name and password and waits for the board to join the network (up to 30 s). Rejects with
   * `unable_to_connect` when it could not, `invalid_rpc` when it refused the settings.
   */
  provision(ssid: string, password: string): Promise<void> {
    const name = encoder.encode(ssid);
    const secret = encoder.encode(password);
    const args = wifiSettingsArgs(name, secret);
    name.fill(0);
    secret.fill(0);
    const frame = rpcFrame(RpcCommandCode.WifiSettings, args);
    args.fill(0);
    return this.run<void>(frame, this.timeouts.provision, (done) => {
      let grace: ReturnType<typeof setTimeout> | null = null;
      const finish = (): void => {
        if (grace !== null) clearTimeout(grace);
        done();
      };
      return (frame) => {
        if (frame.kind === "error") {
          const error = failureFor(frame.error);
          if (error === null) return false;
          if (grace !== null) clearTimeout(grace);
          this.current?.fail(error);
          return false;
        }
        if (frame.kind === "state" && frame.state === ImprovState.Provisioned) {
          grace ??= setTimeout(finish, RESULT_GRACE_MS);
          return false;
        }
        if (frame.kind === "result" && frame.command === RpcCommandCode.WifiSettings) {
          finish();
          return true;
        }
        return false;
      };
    });
  }
}
