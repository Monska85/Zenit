// SPDX-License-Identifier: GPL-3.0-or-later

import { ConnectionClosed } from "../src/protocol/transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openWebSocket, type SocketLike } from "../src/protocol/websocket";
import { text } from "./helpers";

class FakeSocket implements SocketLike {
  binaryType = "blob";
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  sent: string[] = [];
  closeCalls = 0;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls++;
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function open() {
  let socket!: FakeSocket;
  const promise = openWebSocket("ws://127.0.0.1:8765", (url) => (socket = new FakeSocket(url)));
  return { socket, promise };
}

describe("openWebSocket", () => {
  it("connects to the url given and resolves once it is open", async () => {
    const { socket, promise } = open();
    expect(socket.url).toBe("ws://127.0.0.1:8765");
    socket.onopen?.({});
    const transport = await promise;
    expect(transport.kind).toBe("websocket");
  });

  it("fails when the connection is refused", async () => {
    const { socket, promise } = open();
    socket.onerror?.({});
    await expect(promise).rejects.toThrow("failed");
    expect(socket.closeCalls).toBe(1);
  });

  it("fails when it is closed before it opens", async () => {
    const { socket, promise } = open();
    socket.onclose?.({ code: 1006, reason: "" });
    await expect(promise).rejects.toThrow();
  });

  it("fails after 5 seconds without an answer", async () => {
    const { socket, promise } = open();
    const result = promise.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(((await result) as Error).message).toContain("in time");
    expect(socket.closeCalls).toBe(1);
  });

  it("fails when the socket cannot be made", async () => {
    await expect(
      openWebSocket("ws://x", () => {
        throw new SyntaxError("bad url");
      }),
    ).rejects.toThrow("bad url");
  });
});

describe("the transport", () => {
  async function connected() {
    const { socket, promise } = open();
    socket.onopen?.({});
    const transport = await promise;
    const lines: string[] = [];
    transport.onLine = (line) => lines.push(new TextDecoder().decode(line));
    return { socket, transport, lines };
  }

  it("sends a line as one text message, without a newline", async () => {
    const { socket, transport } = await connected();
    await transport.send(text('@ZN 3c250228 {"seq":1,"cmd":"info"}'));
    expect(socket.sent).toEqual(['@ZN 3c250228 {"seq":1,"cmd":"info"}']);
  });

  it("hands over each text message as a line", async () => {
    const { socket, lines } = await connected();
    socket.onmessage?.({ data: "@ZN 1 {}" });
    socket.onmessage?.({ data: "é" });
    expect(lines).toEqual(["@ZN 1 {}", "é"]);
  });

  it("throws away a binary message and a message over 4,096 bytes", async () => {
    const { socket, lines } = await connected();
    socket.onmessage?.({ data: new ArrayBuffer(4) });
    socket.onmessage?.({ data: new Blob(["x"]) });
    socket.onmessage?.({ data: "a".repeat(4097) });
    socket.onmessage?.({ data: "é".repeat(2049) });
    socket.onmessage?.({ data: "a".repeat(4096) });
    expect(lines).toEqual(["a".repeat(4096)]);
  });

  it("refuses a text longer than the limit before it encodes it", async () => {
    const { socket, lines } = await connected();
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    socket.onmessage?.({ data: "a".repeat(1_000_000) });
    expect(encode).not.toHaveBeenCalled();
    encode.mockRestore();
    expect(lines).toEqual([]);
  });

  it("tells the client once when the socket closes, with the reason", async () => {
    const { socket, transport } = await connected();
    const closed = vi.fn();
    transport.onClose = closed;
    socket.onclose?.({ code: 1008, reason: "origin" });
    socket.onclose?.({ code: 1008, reason: "origin" });
    expect(closed).toHaveBeenCalledTimes(1);
    expect((closed.mock.calls[0]?.[0] as Error).message).toBe("origin");
  });

  it("carries the close status the board used, so the app can explain it", async () => {
    const { socket, transport } = await connected();
    const closed = vi.fn();
    transport.onClose = closed;
    socket.onclose?.({ code: 1013, reason: "" });
    const cause = closed.mock.calls[0]?.[0] as ConnectionClosed;
    expect(cause).toBeInstanceOf(ConnectionClosed);
    expect(cause.code).toBe(1013);
  });

  it("says nothing about a close with no status or a normal one", async () => {
    for (const code of [1000, 1005]) {
      const { socket, transport } = await connected();
      const closed = vi.fn();
      transport.onClose = closed;
      socket.onclose?.({ code, reason: "" });
      expect(closed).toHaveBeenCalledWith(undefined);
    }
  });

  it("closes the socket, and says so once, when the app closes it", async () => {
    const { socket, transport } = await connected();
    const closed = vi.fn();
    transport.onClose = closed;
    await transport.close();
    socket.onclose?.({ code: 1000, reason: "" });
    expect(socket.closeCalls).toBe(1);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("fails a send on a socket that refuses it", async () => {
    const { socket, transport } = await connected();
    socket.send = () => {
      throw new Error("not open");
    };
    await expect(transport.send(text("x"))).rejects.toThrow("not open");
  });
});
