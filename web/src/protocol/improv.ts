// SPDX-License-Identifier: GPL-3.0-or-later

// Improv Wi-Fi Serial, version 1 (https://www.improv-wifi.com/serial/), as docs/board/wifi-and-updates-v1.md#setup-with-improv
// uses it, from the client's side. A frame is `IMPROV`, the version, a type, the length of the data, the data and a
// checksum (the sum of every earlier byte, modulo 256). The board ends each frame it sends with a newline that the
// checksum does not cover. The demultiplexer follows lib/ZenitImprov/src/improv_frame.cpp byte by byte, so both ends cut a
// stream into the same frames and the same protocol lines (conformance/improv/frames.json).

export const IMPROV_VERSION = 1;
export const MAX_DATA = 255;
/** A frame that stops for this long is dropped, so a lost byte never swallows the lines after it. */
export const FRAME_IDLE_MS = 1000;

const HEADER = Uint8Array.from([..."IMPROV"].map((c) => c.charCodeAt(0)).concat(IMPROV_VERSION));

export const FrameType = { CurrentState: 0x01, ErrorState: 0x02, RpcCommand: 0x03, RpcResult: 0x04 } as const;
export const ImprovState = { Ready: 0x02, Provisioning: 0x03, Provisioned: 0x04 } as const;
export const ImprovErrorCode = { None: 0x00, InvalidRpc: 0x01, UnknownRpc: 0x02, UnableToConnect: 0x03 } as const;
export const RpcCommandCode = { WifiSettings: 0x01, CurrentState: 0x02, DeviceInfo: 0x03, ScanNetworks: 0x04 } as const;

const checksum = (bytes: ArrayLike<number>): number => {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum = (sum + (bytes[i] as number)) & 0xff;
  return sum;
};

/** A whole frame, without a trailing newline (the board does not need one). */
export function improvPacket(type: number, data: Uint8Array): Uint8Array {
  if (data.length > MAX_DATA) throw new RangeError("an Improv frame holds at most 255 bytes of data");
  const frame = new Uint8Array(HEADER.length + 2 + data.length + 1);
  frame.set(HEADER);
  frame[HEADER.length] = type;
  frame[HEADER.length + 1] = data.length;
  frame.set(data, HEADER.length + 2);
  frame[frame.length - 1] = checksum(frame.subarray(0, frame.length - 1));
  return frame;
}

/** An RPC command frame: the data is the command byte, the length of the arguments and the arguments. */
export function rpcFrame(command: number, args: Uint8Array = new Uint8Array(0)): Uint8Array {
  const data = new Uint8Array(2 + args.length);
  data[0] = command;
  data[1] = args.length;
  data.set(args, 2);
  const frame = improvPacket(FrameType.RpcCommand, data);
  // The arguments may hold a password: this copy is not kept
  data.fill(0);
  return frame;
}

/** The arguments of "send WiFi settings": the name's length, the name, the password's length, the password. */
export function wifiSettingsArgs(ssid: Uint8Array, password: Uint8Array): Uint8Array {
  const args = new Uint8Array(2 + ssid.length + password.length);
  args[0] = ssid.length;
  args.set(ssid, 1);
  args[1 + ssid.length] = password.length;
  args.set(password, 2 + ssid.length);
  return args;
}

export type DemuxEvent =
  /** Bytes for the protocol's line reader, in order. */
  { kind: "pass"; bytes: Uint8Array } | { kind: "frame"; type: number; data: Uint8Array } | { kind: "bad_checksum" };

type Mode = "line_start" | "inside" | "header" | "body";

/**
 * Splits the bytes of the serial port into Improv frames and everything else. A frame starts at the beginning of a line
 * with `IMPROV` and the version byte, and its length decides where it ends, whatever the bytes are.
 */
export class ImprovDemux {
  private mode: Mode = "line_start";
  private held: number[] = [];
  private seen = 0;
  private type = 0;
  private length = 0;
  private sum = 0;
  private data: number[] = [];
  private lastByteAt = 0;

  feed(chunk: Uint8Array, now: number): DemuxEvent[] {
    const events: DemuxEvent[] = [];
    let pass: number[] = [];
    const flush = (): void => {
      if (pass.length > 0) events.push({ kind: "pass", bytes: Uint8Array.from(pass) });
      pass = [];
    };
    // The held header bytes first, then this one, so the line reader sees every byte in order
    const passthrough = (byte: number): void => {
      pass.push(...this.held, byte);
      this.held = [];
      this.mode = byte === 0x0a ? "line_start" : "inside";
    };
    this.lastByteAt = now;
    for (const byte of chunk) {
      switch (this.mode) {
        case "line_start":
        case "inside":
          if (this.mode === "line_start" && byte === HEADER[0]) {
            this.held = [byte];
            this.mode = "header";
          } else passthrough(byte);
          break;
        case "header":
          if (byte === HEADER[this.held.length]) {
            this.held.push(byte);
            if (this.held.length === HEADER.length) {
              this.held = [];
              this.mode = "body";
              this.seen = this.type = this.length = 0;
              this.sum = checksum(HEADER);
              this.data = [];
            }
          } else passthrough(byte);
          break;
        case "body": {
          const at = this.seen++;
          if (at === 0) {
            this.type = byte;
            this.sum = (this.sum + byte) & 0xff;
          } else if (at === 1) {
            this.length = byte;
            this.sum = (this.sum + byte) & 0xff;
          } else if (at < 2 + this.length) {
            this.data.push(byte);
            this.sum = (this.sum + byte) & 0xff;
          } else {
            // The end of a frame counts as the start of a line: the next frame may follow with no newline between
            this.mode = "line_start";
            flush();
            if (byte === this.sum) events.push({ kind: "frame", type: this.type, data: Uint8Array.from(this.data) });
            else events.push({ kind: "bad_checksum" });
            this.data = [];
          }
          break;
        }
      }
    }
    flush();
    return events;
  }

  /** Drops a frame that has stopped. Returns true when it did. */
  idle(now: number): boolean {
    if ((this.mode === "header" || this.mode === "body") && now - this.lastByteAt >= FRAME_IDLE_MS) {
      this.data = [];
      this.held = [];
      this.mode = "line_start";
      return true;
    }
    return false;
  }

  /** Whether a frame, or the start of one, is waiting for more bytes. */
  get partial(): boolean {
    return this.mode === "header" || this.mode === "body";
  }
}

/** What a frame from the board says. */
export type BoardFrame =
  | { kind: "state"; state: number }
  | { kind: "error"; error: number }
  | { kind: "result"; command: number; strings: string[] };

const decoder = new TextDecoder("utf-8", { fatal: false });

/** The meaning of a frame the board sent, or null for a type or a layout this client does not know. */
export function readBoardFrame(type: number, data: Uint8Array): BoardFrame | null {
  if (type === FrameType.CurrentState && data.length === 1) return { kind: "state", state: data[0] as number };
  if (type === FrameType.ErrorState && data.length === 1) return { kind: "error", error: data[0] as number };
  if (type !== FrameType.RpcResult || data.length < 2) return null;
  const command = data[0] as number;
  if ((data[1] as number) !== data.length - 2) return null;
  const strings: string[] = [];
  let at = 2;
  while (at < data.length) {
    const size = data[at] as number;
    if (at + 1 + size > data.length) return null;
    strings.push(decoder.decode(data.subarray(at + 1, at + 1 + size)));
    at += 1 + size;
  }
  return { kind: "result", command, strings };
}
