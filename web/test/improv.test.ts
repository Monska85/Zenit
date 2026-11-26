// SPDX-License-Identifier: GPL-3.0-or-later

// The Improv codec and demultiplexer against the hand-worked packets and streams of conformance/improv/frames.json,
// which the firmware's native tests run too.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FRAME_IDLE_MS,
  FrameType,
  ImprovDemux,
  improvPacket,
  readBoardFrame,
  rpcFrame,
  wifiSettingsArgs,
  type DemuxEvent,
} from "../src/protocol/improv";
import { toHex } from "../src/protocol/sha256";
import { fromHex } from "./helpers";

interface Packet {
  name: string;
  hex: string;
  state?: number;
  error?: number;
  command?: number;
  strings?: string[];
}
interface Stream {
  name: string;
  hex: string;
  events: Array<{ frame?: { type: number; data_hex: string }; pass_hex?: string; bad_checksum?: boolean }>;
}
interface Frames {
  packets: Packet[];
  wifi_settings: Array<{ args_hex: string; ssid: string; password: string }>;
  wifi_settings_invalid: string[];
  streams: Stream[];
}

const frames = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "conformance", "improv", "frames.json"), "utf8"),
) as Frames;

const encoder = new TextEncoder();

/** The events as the case lists them: adjacent passes joined. */
function joined(events: DemuxEvent[]): unknown[] {
  const out: unknown[] = [];
  for (const event of events) {
    const last = out[out.length - 1] as { pass_hex?: string } | undefined;
    if (event.kind === "pass") {
      if (last?.pass_hex !== undefined) last.pass_hex += toHex(event.bytes);
      else out.push({ pass_hex: toHex(event.bytes) });
    } else if (event.kind === "frame") out.push({ frame: { type: event.type, data_hex: toHex(event.data) } });
    else out.push({ bad_checksum: true });
  }
  return out;
}

describe("improvPacket", () => {
  it.each(frames.packets.map((packet) => [packet.name, packet] as const))("builds %s", (_, packet) => {
    // The board ends its frames with a newline; the client's frames need none
    const expected = packet.hex.replace(/0a$/, "");
    let built: Uint8Array;
    if (packet.state !== undefined) built = improvPacket(FrameType.CurrentState, Uint8Array.of(packet.state));
    else if (packet.error !== undefined) built = improvPacket(FrameType.ErrorState, Uint8Array.of(packet.error));
    else {
      const body: number[] = [];
      for (const text of packet.strings ?? []) body.push(encoder.encode(text).length, ...encoder.encode(text));
      built = improvPacket(FrameType.RpcResult, Uint8Array.of(packet.command ?? 0, body.length, ...body));
    }
    expect(toHex(built)).toBe(expected);
  });

  it("refuses more than 255 bytes of data", () => {
    expect(() => improvPacket(FrameType.RpcCommand, new Uint8Array(256))).toThrow(RangeError);
  });
});

describe("readBoardFrame", () => {
  it.each(frames.packets.map((packet) => [packet.name, packet] as const))("reads %s", (_, packet) => {
    const bytes = fromHex(packet.hex);
    // type at 7, length at 8, data after, checksum and newline at the end
    const frame = readBoardFrame(bytes[7] as number, bytes.subarray(9, 9 + (bytes[8] as number)));
    if (packet.state !== undefined) expect(frame).toEqual({ kind: "state", state: packet.state });
    else if (packet.error !== undefined) expect(frame).toEqual({ kind: "error", error: packet.error });
    else expect(frame).toEqual({ kind: "result", command: packet.command, strings: packet.strings });
  });

  it("refuses a result whose lengths do not add up", () => {
    expect(readBoardFrame(FrameType.RpcResult, Uint8Array.of(3, 5, 1, 65))).toBeNull();
    expect(readBoardFrame(FrameType.RpcResult, Uint8Array.of(3, 2, 9, 65))).toBeNull();
    expect(readBoardFrame(FrameType.RpcResult, Uint8Array.of(3))).toBeNull();
    expect(readBoardFrame(FrameType.CurrentState, Uint8Array.of(1, 2))).toBeNull();
    expect(readBoardFrame(0x7f, Uint8Array.of(1))).toBeNull();
  });
});

describe("wifiSettingsArgs", () => {
  it.each(frames.wifi_settings.map((entry) => [entry.ssid, entry] as const))(
    "lays out the arguments of %s",
    (_, entry) => {
      expect(toHex(wifiSettingsArgs(encoder.encode(entry.ssid), encoder.encode(entry.password)))).toBe(entry.args_hex);
    },
  );

  it("makes the RPC frame of command 1", () => {
    const args = wifiSettingsArgs(encoder.encode("Cafe"), new Uint8Array(0));
    const frame = rpcFrame(1, args);
    expect(toHex(frame.subarray(0, 11))).toBe("494d50524f5601" + "03" + "08" + "01" + "06");
    expect(toHex(frame.subarray(11, 17))).toBe("044361666500");
    const sum = frame.subarray(0, frame.length - 1).reduce((total, byte) => (total + byte) & 0xff, 0);
    expect(frame[frame.length - 1]).toBe(sum);
    expect(frame).toHaveLength(18);
  });
});

describe("ImprovDemux", () => {
  it.each(frames.streams.map((stream) => [stream.name, stream] as const))("cuts the stream %s", (_, stream) => {
    expect(joined(new ImprovDemux().feed(fromHex(stream.hex), 0))).toEqual(stream.events);
  });

  it.each(frames.streams.map((stream) => [stream.name, stream] as const))(
    "cuts the stream %s the same way one byte at a time",
    (_, stream) => {
      const demux = new ImprovDemux();
      const events: DemuxEvent[] = [];
      for (const byte of fromHex(stream.hex)) events.push(...demux.feed(Uint8Array.of(byte), 0));
      expect(joined(events)).toEqual(stream.events);
    },
  );

  it("drops a frame that stops for a second, and passes the lines after it", () => {
    const demux = new ImprovDemux();
    expect(demux.feed(fromHex("494d50524f56010302"), 100)).toEqual([]);
    expect(demux.partial).toBe(true);
    expect(demux.idle(100 + FRAME_IDLE_MS - 1)).toBe(false);
    expect(demux.idle(100 + FRAME_IDLE_MS)).toBe(true);
    expect(demux.partial).toBe(false);
    expect(joined(demux.feed(new TextEncoder().encode("@ZN 1 {}\n"), 2000))).toEqual([
      { pass_hex: toHex(new TextEncoder().encode("@ZN 1 {}\n")) },
    ]);
  });
});
