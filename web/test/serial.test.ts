// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BAUD_RATE,
  BUFFER_SIZE,
  CLOSE_STEP_MS,
  LineSplitter,
  PortStuckError,
  openSerial,
  type SerialPortLike,
} from "../src/protocol/serial";
import { text } from "./helpers";

const decode = (line: Uint8Array): string => new TextDecoder().decode(line);

/** A Web Serial port: `push` plays bytes from the board, `written` is what the app wrote. */
class FakePort implements SerialPortLike {
  openOptions: { baudRate: number; bufferSize?: number } | null = null;
  written: string[] = [];
  closeCalls = 0;
  /** A write that never ends, as on a device that stopped taking bytes. */
  wedgeWrites = false;
  /** What closing the port does: it closes, never ends, or fails. */
  closeBehavior: "closes" | "hangs" | "fails" = "closes";
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  /** Anything but open, close, readable and writable is a call the transport must not make. */
  setSignals = vi.fn(() => {
    throw new Error("setSignals must not be called");
  });
  getSignals = vi.fn();

  async open(options: { baudRate: number; bufferSize?: number }): Promise<void> {
    this.openOptions = options;
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        if (this.wedgeWrites) return new Promise<void>(() => undefined);
        this.written.push(decode(chunk));
      },
    });
  }

  async close(): Promise<void> {
    this.closeCalls++;
    if (this.closeBehavior === "hangs") return new Promise<void>(() => undefined);
    if (this.closeBehavior === "fails") throw new TypeError("the streams are locked");
  }

  push(data: string | Uint8Array): void {
    this.controller?.enqueue(typeof data === "string" ? text(data) : data);
  }

  /** The cable is pulled: the read ends with an error. */
  unplug(): void {
    this.controller?.error(new DOMException("The device has been lost.", "NetworkError"));
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("LineSplitter", () => {
  it("cuts at newlines and keeps a partial line for the next chunk", () => {
    const splitter = new LineSplitter();
    expect(splitter.push(text("ab\ncd")).map(decode)).toEqual(["ab"]);
    expect(splitter.push(text("ef\n\ngh\n")).map(decode)).toEqual(["cdef", "", "gh"]);
  });

  it("keeps a carriage return, which the line parser handles", () => {
    expect(new LineSplitter().push(text("ab\r\n")).map(decode)).toEqual(["ab\r"]);
  });

  it("joins a multi-byte character cut between chunks", () => {
    const splitter = new LineSplitter();
    const bytes = text("é\n");
    expect(splitter.push(bytes.slice(0, 1))).toEqual([]);
    expect(splitter.push(bytes.slice(1)).map(decode)).toEqual(["é"]);
  });

  it("drops bytes that never end in a newline once there are too many", () => {
    const splitter = new LineSplitter();
    expect(splitter.push(new Uint8Array(9000).fill(65))).toEqual([]);
    expect(splitter.push(text("ok\n")).map(decode)).toEqual(["ok"]);
  });
});

describe("openSerial", () => {
  it("opens at 115,200 baud with an 8,192-byte buffer", async () => {
    const port = new FakePort();
    await openSerial(port);
    expect(port.openOptions).toEqual({ baudRate: BAUD_RATE, bufferSize: BUFFER_SIZE });
    expect(BAUD_RATE).toBe(115200);
    expect(BUFFER_SIZE).toBeGreaterThanOrEqual(8192);
  });

  it("never touches the control lines", async () => {
    const port = new FakePort();
    const transport = await openSerial(port);
    port.push("@ZN x\n");
    await transport.send(text("hello"));
    await transport.close();
    expect(port.setSignals).not.toHaveBeenCalled();
    expect(port.getSignals).not.toHaveBeenCalled();
  });

  it("hands over each line, protocol or log, as the board writes it", async () => {
    const port = new FakePort();
    const transport = await openSerial(port);
    const lines: string[] = [];
    transport.onLine = (line) => lines.push(decode(line));
    port.push('zenit: booting\n@ZN 3c250228 {"seq":1');
    port.push(',"cmd":"info"}\r\nlast');
    await tick();
    expect(lines).toEqual(["zenit: booting", '@ZN 3c250228 {"seq":1,"cmd":"info"}\r']);
  });

  it("writes a line with a newline", async () => {
    const port = new FakePort();
    const transport = await openSerial(port);
    await transport.send(text("@ZN 1 {}"));
    await transport.send(text("second"));
    expect(port.written).toEqual(["@ZN 1 {}\n", "second\n"]);
  });

  it("tells the client when the cable is pulled", async () => {
    const port = new FakePort();
    const transport = await openSerial(port);
    const closed = vi.fn();
    transport.onClose = closed;
    port.unplug();
    await tick();
    expect(closed).toHaveBeenCalledTimes(1);
    expect((closed.mock.calls[0]?.[0] as Error).message).toContain("lost");
    await expect(transport.send(text("x"))).rejects.toThrow();
    // closing afterwards releases the port without error and without a second notice
    await transport.close();
    expect(port.closeCalls).toBe(1);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("closes the port, once, and tells the client once", async () => {
    const port = new FakePort();
    const transport = await openSerial(port);
    const closed = vi.fn();
    transport.onClose = closed;
    await transport.close();
    await transport.close();
    expect(port.closeCalls).toBe(1);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledWith(undefined);
    await expect(transport.send(text("x"))).rejects.toThrow();
  });

  it("closes a port that has no streams, and fails", async () => {
    const port = new FakePort();
    port.open = async () => undefined;
    await expect(openSerial(port)).rejects.toThrow();
    expect(port.closeCalls).toBe(1);
  });

  it("fails when the port cannot be opened", async () => {
    const port = new FakePort();
    port.open = () => Promise.reject(new DOMException("Failed to open", "NetworkError"));
    await expect(openSerial(port)).rejects.toThrow("Failed to open");
  });

  describe("closing a port that does not let go", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("gives up on a write that never ends, rejects that write, and still closes the port", async () => {
      const port = new FakePort();
      port.wedgeWrites = true;
      const transport = await openSerial(port);
      const write = transport.send(text("stuck")).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(10);
      const closing = transport.close();
      await vi.advanceTimersByTimeAsync(CLOSE_STEP_MS * 6);
      await closing;
      expect(port.closeCalls).toBe(1);
      expect(((await write) as Error).message).toContain("closed");
    });

    it("says the port is stuck when closing it never ends", async () => {
      const port = new FakePort();
      port.closeBehavior = "hangs";
      const transport = await openSerial(port);
      const closed = vi.fn();
      transport.onClose = closed;
      const closing = transport.close().catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(CLOSE_STEP_MS * 8);
      expect(await closing).toBeInstanceOf(PortStuckError);
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it("says the port is stuck when closing it fails", async () => {
      const port = new FakePort();
      port.closeBehavior = "fails";
      const transport = await openSerial(port);
      await expect(transport.close()).rejects.toBeInstanceOf(PortStuckError);
    });
  });
});
