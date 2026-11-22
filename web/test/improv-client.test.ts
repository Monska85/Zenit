// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImprovClient, ImprovError, MAX_NETWORKS } from "../src/protocol/improv-client";
import { FrameType, ImprovErrorCode, ImprovState, RpcCommandCode, rpcFrame } from "../src/protocol/improv";
import { ScriptedImprov } from "./helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const encoder = new TextEncoder();
const result = (command: number, strings: string[]): [number, number[]] => {
  const body = strings.flatMap((text) => [encoder.encode(text).length, ...encoder.encode(text)]);
  return [FrameType.RpcResult, [command, body.length, ...body]];
};
const state = (value: number): [number, number[]] => [FrameType.CurrentState, [value]];
const error = (value: number): [number, number[]] => [FrameType.ErrorState, [value]];

function setup(timeouts = {}) {
  const link = new ScriptedImprov();
  const client = new ImprovClient(link, timeouts);
  const play = (...frames: Array<[number, number[]]>): void =>
    frames.forEach(([type, data]) => link.receive(type, data));
  return { link, client, play };
}

/** The command and arguments of the RPC frame the client wrote. */
const rpcOf = (frame: Uint8Array): { command: number; args: Uint8Array } => ({
  command: frame[9] as number,
  args: frame.subarray(11, 11 + (frame[10] as number)),
});

describe("ImprovClient", () => {
  it("asks for the state and learns it", async () => {
    const { link, client, play } = setup();
    link.respond = () => play(state(ImprovState.Ready));
    await expect(client.requestState()).resolves.toBe(ImprovState.Ready);
    expect(client.state).toBe(ImprovState.Ready);
    expect(rpcOf(link.written[0] as Uint8Array).command).toBe(RpcCommandCode.CurrentState);
  });

  it("reads the device info", async () => {
    const { link, client, play } = setup();
    link.respond = () => play(result(3, ["Zenit", "1.0.0", "ESP32-C3", "zenit-a1b2"]));
    await expect(client.deviceInfo()).resolves.toEqual({
      firmwareName: "Zenit",
      firmwareVersion: "1.0.0",
      chip: "ESP32-C3",
      hostname: "zenit-a1b2",
    });
  });

  it("scans until the empty result, strongest first, one entry per name", async () => {
    const { link, client, play } = setup();
    link.respond = () =>
      play(
        result(4, ["Weak", "-80", "YES"]),
        result(4, ["Home", "-60", "YES"]),
        result(4, ["Home", "-50", "YES"]),
        result(4, ["Cafe", "-70", "NO"]),
        result(4, []),
      );
    await expect(client.scan()).resolves.toEqual([
      { ssid: "Home", rssi: -50, secure: true },
      { ssid: "Cafe", rssi: -70, secure: false },
      { ssid: "Weak", rssi: -80, secure: true },
    ]);
  });

  it("keeps at most 16 networks", async () => {
    const { link, client, play } = setup();
    link.respond = () => {
      for (let i = 0; i < 20; i++) play(result(4, [`net${i}`, String(-30 - i), "YES"]));
      play(result(4, []));
    };
    expect(await client.scan()).toHaveLength(MAX_NETWORKS);
  });

  it("times out a scan that never ends", async () => {
    const { client } = setup({ scan: 1000 });
    const scan = client.scan();
    const failed = expect(scan).rejects.toMatchObject({ failure: "timeout" });
    await vi.advanceTimersByTimeAsync(1001);
    await failed;
  });

  it("sends the WiFi settings and resolves when the board is provisioned", async () => {
    const { link, client, play } = setup();
    link.respond = () =>
      play(error(ImprovErrorCode.None), state(ImprovState.Provisioning), state(ImprovState.Provisioned), result(1, []));
    await client.provision("HomeNet", "correct-horse");
    const { command, args } = rpcOf(link.written[0] as Uint8Array);
    expect(command).toBe(RpcCommandCode.WifiSettings);
    expect(new TextDecoder().decode(args)).toContain("HomeNet");
  });

  it("goes on after provisioned even when the empty result is lost", async () => {
    const { link, client, play } = setup();
    link.respond = () => play(state(ImprovState.Provisioning), state(ImprovState.Provisioned));
    const done = client.provision("HomeNet", "");
    await vi.advanceTimersByTimeAsync(2100);
    await expect(done).resolves.toBeUndefined();
  });

  it("fails with unable_to_connect, then the board says ready", async () => {
    const { link, client, play } = setup();
    link.respond = () =>
      play(state(ImprovState.Provisioning), error(ImprovErrorCode.UnableToConnect), state(ImprovState.Ready));
    await expect(client.provision("HomeNet", "wrong-password")).rejects.toMatchObject({ failure: "unable_to_connect" });
    expect(client.state).toBe(ImprovState.Ready);
  });

  it("fails with invalid_rpc when the board refuses the settings", async () => {
    const { link, client, play } = setup();
    link.respond = () => play(error(ImprovErrorCode.InvalidRpc));
    await expect(client.provision("HomeNet", "x")).rejects.toMatchObject({ failure: "invalid_rpc" });
  });

  it("gives up on a connection that takes longer than the board's 30 seconds", async () => {
    const { client } = setup();
    const done = client.provision("HomeNet", "correct-horse");
    const failed = expect(done).rejects.toMatchObject({ failure: "timeout" });
    await vi.advanceTimersByTimeAsync(35_001);
    await failed;
  });

  it("wipes the bytes it sent, and carries the password in no error", async () => {
    const written: Uint8Array[] = [];
    const link = new ScriptedImprov();
    const original = link.sendFrame.bind(link);
    link.sendFrame = (frame) => {
      written.push(frame);
      return original(frame);
    };
    const client = new ImprovClient(link, { provision: 500 });
    link.respond = () => link.receive(...error(ImprovErrorCode.UnableToConnect));
    let caught: unknown;
    await client.provision("HomeNet", "very-secret-pass").catch((e: unknown) => (caught = e));
    await vi.advanceTimersByTimeAsync(0);
    expect(caught).toBeInstanceOf(ImprovError);
    expect(String((caught as Error).message)).not.toContain("secret");
    expect(written[0]?.every((byte) => byte === 0)).toBe(true);
  });

  it("clears the intermediate copy of the arguments of a frame", () => {
    const fill = vi.spyOn(Uint8Array.prototype, "fill");
    try {
      rpcFrame(1, new Uint8Array([9, 8, 7]));
      // The data array holds the command, the length and the three arguments
      expect(fill.mock.contexts.some((array) => (array as Uint8Array).length === 5)).toBe(true);
    } finally {
      fill.mockRestore();
    }
  });

  it("runs one request at a time", async () => {
    const { client } = setup();
    void client.requestState().catch(() => undefined);
    await expect(client.deviceInfo()).rejects.toMatchObject({ failure: "busy" });
  });

  it("fails a request in progress when it is disposed", async () => {
    const { client } = setup();
    const done = client.scan();
    const failed = expect(done).rejects.toMatchObject({ failure: "link" });
    client.dispose();
    await failed;
  });

  it("reports a write that fails", async () => {
    const { link, client } = setup();
    link.sendFrame = () => Promise.reject(new Error("unplugged"));
    await expect(client.requestState()).rejects.toMatchObject({ failure: "link" });
  });

  it("ignores frames it does not know, and reports state changes to its listener", async () => {
    const { link, client, play } = setup();
    const seen: number[] = [];
    client.onState = (value) => seen.push(value);
    link.respond = () => play([0x7f, [1, 2, 3]], state(ImprovState.Ready));
    await client.requestState();
    expect(seen).toEqual([ImprovState.Ready]);
  });
});
