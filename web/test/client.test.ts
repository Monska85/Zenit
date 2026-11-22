// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardError, Client, ClientError } from "../src/protocol/client";
import { parseLine } from "../src/protocol/frame";
import { FakeBoard, INFO, ScriptedTransport, lineOf, rawLine, text } from "./helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const info = (seq: number) => ({ seq, ok: true, ...INFO });

describe("Client.request", () => {
  it("sends a framed request with the next seq and returns the reply", async () => {
    const transport = new ScriptedTransport();
    transport.respond = (request) => [info(request["seq"] as number)];
    const client = new Client(transport, { seq: 10 });
    const reply = await client.request("info");
    expect(reply["seq"]).toBe(10);
    expect(parseLine(transport.written[0] as Uint8Array)).toEqual({ seq: 10, cmd: "info" });
    transport.respond = (request) => [
      {
        seq: request["seq"],
        ok: true,
        light: { on: true, effect: "static", color: "white", lightness: 1.5, power_scale: 100, timer: null },
      },
    ];
    await client.request("status");
    expect(parseLine(transport.written[1] as Uint8Array)).toEqual({ seq: 11, cmd: "status" });
  });

  it("starts at a random seq below 2^31", async () => {
    const seen = new Set<number>();
    for (let i = 0; i < 5; i++) {
      const transport = new ScriptedTransport();
      transport.respond = (request) => [info(request["seq"] as number)];
      await new Client(transport).request("info");
      const seq = parseLine(transport.written[0] as Uint8Array)?.["seq"] as number;
      expect(seq).toBeGreaterThanOrEqual(0);
      expect(seq).toBeLessThan(2 ** 31);
      seen.add(seq);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("wraps seq at 2^32", async () => {
    const transport = new ScriptedTransport();
    transport.respond = (request) => [info(request["seq"] as number)];
    const client = new Client(transport, { seq: 2 ** 32 - 1 });
    await client.request("info");
    await client.request("info");
    expect(parseLine(transport.written[1] as Uint8Array)?.["seq"]).toBe(0);
  });

  it("refuses seq and cmd as fields", () => {
    const client = new Client(new ScriptedTransport());
    expect(() => client.request("info", { seq: 5 })).toThrow(TypeError);
    expect(() => client.request("info", { cmd: "x" })).toThrow(TypeError);
  });

  it("sends the same line again after 2 seconds, 5 tries in all, then fails", async () => {
    const transport = new ScriptedTransport();
    const client = new Client(transport, { seq: 1 });
    const result = client.request("info").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2000 * 5 + 10);
    const error = await result;
    expect(error).toBeInstanceOf(ClientError);
    expect((error as ClientError).failure).toBe("no_reply");
    expect(transport.written).toHaveLength(5);
    expect(new Set(transport.written.map((line) => new TextDecoder().decode(line))).size).toBe(1);
  });

  it("gets a late reply to the first try as the reply, once", async () => {
    const transport = new ScriptedTransport();
    const client = new Client(transport, { seq: 1 });
    const result = client.request("info");
    await vi.advanceTimersByTimeAsync(2100);
    expect(transport.written).toHaveLength(2);
    transport.receive(lineOf(info(1)));
    const reply = await result;
    expect(reply["ok"]).toBe(true);
  });

  it("sends again at once after a bad_frame reply without seq", async () => {
    const transport = new ScriptedTransport();
    let tries = 0;
    transport.respond = (request) =>
      ++tries === 1 ? [{ ok: false, error: "bad_frame", message: "damaged" }] : [info(request["seq"] as number)];
    const client = new Client(transport, { seq: 4 });
    const result = await client.request("info");
    expect(result["ok"]).toBe(true);
    expect(transport.written).toHaveLength(2);
  });

  it.each([
    ["log text", () => text("zenit: booting")],
    ["a bad checksum", () => text('@ZN 00000000 {"seq":7,"ok":true}')],
    ["an event", () => lineOf({ event: "wifi", state: "up" })],
    ["a reply of another seq", () => lineOf(info(99))],
    ["a reply whose seq is a float", () => rawLine('{"seq":7.0,"ok":true}')],
  ])("throws away %s and keeps waiting", async (_name, make) => {
    const transport = new ScriptedTransport();
    const client = new Client(transport, { seq: 7 });
    const result = client.request("info");
    await vi.advanceTimersByTimeAsync(10);
    transport.receive(make());
    transport.receive(lineOf(info(7)));
    expect((await result)["ok"]).toBe(true);
    expect(transport.written).toHaveLength(1);
  });

  it("does not take a reply whose seq has another JSON type", async () => {
    const transport = new ScriptedTransport();
    const client = new Client(transport, { seq: 7 });
    const result = client.request("info").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    transport.receive(rawLine(JSON.stringify({ seq: 7, ok: true, ...INFO }).replace('"seq":7', '"seq":7.0')));
    await vi.advanceTimersByTimeAsync(2000 * 5);
    expect(await result).toBeInstanceOf(ClientError);
  });

  it("asks again when the reply of its seq is not valid", async () => {
    const transport = new ScriptedTransport();
    let tries = 0;
    transport.respond = (request) =>
      ++tries === 1 ? [{ seq: request["seq"], ok: true, protocol: "1" }] : [info(request["seq"] as number)];
    const client = new Client(transport, { seq: 3 });
    const result = client.request("info");
    await vi.advanceTimersByTimeAsync(2100);
    expect((await result)["ok"]).toBe(true);
    expect(transport.written).toHaveLength(2);
  });

  it("says the replies were not well formed when none was", async () => {
    const transport = new ScriptedTransport();
    transport.respond = (request) => [{ seq: request["seq"], ok: true, protocol: "1" }];
    const client = new Client(transport, { seq: 3 });
    const result = client.request("info").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2000 * 5 + 10);
    expect(((await result) as Error).message).toContain("well formed");
  });

  it("returns an error reply as a reply", async () => {
    const transport = new ScriptedTransport();
    transport.respond = (request) => [{ seq: request["seq"], ok: false, error: "busy", message: "wait" }];
    const reply = await new Client(transport, { seq: 1 }).request("settings_get");
    expect(reply).toMatchObject({ ok: false, error: "busy" });
  });

  it("keeps one request in flight and answers in order", async () => {
    const transport = new ScriptedTransport();
    const client = new Client(transport, { seq: 1 });
    const first = client.request("info");
    const second = client.request("info");
    await vi.advanceTimersByTimeAsync(10);
    expect(transport.written).toHaveLength(1);
    expect(client.busy).toBe(true);
    transport.receive(lineOf(info(1)));
    await first;
    await vi.advanceTimersByTimeAsync(10);
    expect(transport.written).toHaveLength(2);
    transport.receive(lineOf(info(2)));
    expect((await second)["seq"]).toBe(2);
    expect(client.busy).toBe(false);
  });

  it("fails every waiting request when the connection closes, and the later ones", async () => {
    const transport = new ScriptedTransport();
    const client = new Client(transport, { seq: 1 });
    const first = client.request("info").catch((error: unknown) => error);
    const second = client.request("info").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    transport.drop(new Error("unplugged"));
    for (const error of [await first, await second]) {
      expect(error).toBeInstanceOf(ClientError);
      expect((error as ClientError).failure).toBe("closed");
    }
    await expect(client.request("info")).rejects.toMatchObject({ failure: "closed" });
  });

  it("fails with closed when the transport cannot write", async () => {
    const transport = new ScriptedTransport();
    transport.closed = true;
    await expect(new Client(transport).request("info")).rejects.toMatchObject({ failure: "closed" });
  });

  it("keeps an unrelated line that arrives while idle without growing without bound", async () => {
    const transport = new ScriptedTransport();
    const client = new Client(transport, { seq: 1 });
    for (let i = 0; i < 1000; i++) transport.receive(lineOf({ event: "tick", n: i }));
    const result = client.request("info");
    await vi.advanceTimersByTimeAsync(10);
    transport.receive(lineOf(info(1)));
    expect((await result)["ok"]).toBe(true);
  });
});

describe("Client.call and handshake", () => {
  it("throws a BoardError for an error reply", async () => {
    const board = new FakeBoard();
    board.errors.set("settings_get", "busy");
    const client = new Client(board.transport(), { seq: 1 });
    await expect(client.call("settings_get")).rejects.toMatchObject({ code: "busy" });
    await expect(client.call("settings_get")).rejects.toBeInstanceOf(BoardError);
  });

  it("sends info first and keeps what it learns", async () => {
    const board = new FakeBoard();
    const client = new Client(board.transport(), { seq: 1 });
    const info = await client.handshake();
    expect(info.firmware).toBe("1.2.3");
    expect(client.info).toEqual(info);
    expect(board.requests[0]?.["cmd"]).toBe("info");
  });

  it("refuses a board of another protocol", async () => {
    const transport = new ScriptedTransport();
    transport.respond = (request) => [{ ...info(request["seq"] as number), protocol: 2 }];
    await expect(new Client(transport, { seq: 1 }).handshake()).rejects.toMatchObject({ failure: "protocol" });
  });
});
