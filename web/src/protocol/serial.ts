// SPDX-License-Identifier: GPL-3.0-or-later

// The board's USB serial port, through Web Serial (docs/web/web-app-v1.md#usb-serial).

import { MAX_REPLY_LINE } from "./frame";
import type { LineTransport } from "./transport";

/** The part of a Web Serial port the transport uses, so a test can stand in for it. */
export interface SerialPortLike {
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
}

export const BAUD_RATE = 115200;
/** The receive buffer the protocol asks for: at least 8,192 bytes (docs/protocol/protocol-v1.md#usb-serial). */
export const BUFFER_SIZE = 8192;
/** Espressif's USB vendor id: the ESP32-C3's own USB serial port. */
export const ESPRESSIF_VENDOR_ID = 0x303a;
/** Bytes without a newline after which the reader gives up on them: the bytes are not a line of ours. */
const MAX_PENDING = 2 * MAX_REPLY_LINE;

/** Cuts a byte stream into lines at `\n`. */
export class LineSplitter {
  private pending: Uint8Array = new Uint8Array(0);

  /** The complete lines in `chunk` and what came before it, without their newlines. */
  push(chunk: Uint8Array): Uint8Array[] {
    const joined = new Uint8Array(this.pending.length + chunk.length);
    joined.set(this.pending);
    joined.set(chunk, this.pending.length);
    const lines: Uint8Array[] = [];
    let start = 0;
    for (let at = joined.indexOf(0x0a, start); at >= 0; at = joined.indexOf(0x0a, start)) {
      lines.push(joined.slice(start, at));
      start = at + 1;
    }
    this.pending = joined.slice(start);
    if (this.pending.length > MAX_PENDING) this.pending = new Uint8Array(0);
    return lines;
  }
}

const NEWLINE = new Uint8Array([0x0a]);

/** How long each step of closing may take: a port whose write never ends must not hold the app, or the installer. */
export const CLOSE_STEP_MS = 500;

/** The port could not be released: the cable has to be unplugged and plugged in again. */
export class PortStuckError extends Error {}

const withLimit = (work: Promise<unknown>, ms: number): Promise<"done" | "late"> =>
  Promise.race([
    work.then(
      () => "done" as const,
      () => "done" as const,
    ),
    new Promise<"late">((resolve) => setTimeout(() => resolve("late"), ms)),
  ]);

class SerialTransport implements LineTransport {
  readonly kind = "usb";
  onLine: ((line: Uint8Array) => void) | null = null;
  onClose: ((cause?: Error) => void) | null = null;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly reading: Promise<void>;
  /** Rejects when the transport closes, so a write that never ends does not hold its caller. */
  private readonly ended: Promise<never>;
  private end: (error: Error) => void = () => undefined;
  private closing = false;
  private closed = false;

  constructor(
    private readonly port: SerialPortLike,
    readable: ReadableStream<Uint8Array>,
    writable: WritableStream<Uint8Array>,
  ) {
    this.reader = readable.getReader();
    this.writer = writable.getWriter();
    this.ended = new Promise<never>((_, reject) => (this.end = reject));
    this.ended.catch(() => undefined);
    this.reading = this.read();
  }

  private async read(): Promise<void> {
    const splitter = new LineSplitter();
    let cause: Error | undefined;
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) for (const line of splitter.push(value)) this.onLine?.(line);
      }
    } catch (error) {
      cause = error instanceof Error ? error : new Error(String(error));
    }
    // The cable pulled, or our own close
    if (!this.closing) this.finish(cause);
  }

  private finish(cause?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose?.(cause);
  }

  async send(line: Uint8Array): Promise<void> {
    if (this.closed || this.closing) throw new Error("the port is closed");
    const bytes = new Uint8Array(line.length + 1);
    bytes.set(line);
    bytes.set(NEWLINE, line.length);
    await Promise.race([this.writer.write(bytes), this.ended]);
  }

  /**
   * Lets go of the port: cancels the reader, aborts the writer and closes the port, each step within CLOSE_STEP_MS.
   * Throws PortStuckError when the port is still held after that.
   */
  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.end(new Error("the port is closed"));
    await withLimit(this.reader.cancel(), CLOSE_STEP_MS);
    await withLimit(this.reading, CLOSE_STEP_MS);
    // Aborting rejects what is queued; a write already inside the device may never settle, so the wait is bounded
    await withLimit(this.writer.abort(new Error("the port is closing")), CLOSE_STEP_MS);
    for (const lock of [this.reader, this.writer]) {
      try {
        lock.releaseLock();
      } catch {
        // a settling operation keeps the lock: closing the port says whether it matters
      }
    }
    let released = false;
    await withLimit(
      this.port.close().then(() => {
        released = true;
      }),
      CLOSE_STEP_MS * 2,
    );
    this.finish();
    if (!released) throw new PortStuckError("the port could not be closed");
  }
}

/**
 * Opens a port at 115,200 baud with the receive buffer the protocol asks for. It never touches DTR and RTS: on the
 * ESP32-C3's USB serial port, driving one before the other runs the reset sequence and restarts the board.
 */
export async function openSerial(port: SerialPortLike): Promise<LineTransport> {
  await port.open({ baudRate: BAUD_RATE, bufferSize: BUFFER_SIZE });
  if (!port.readable || !port.writable) {
    await port.close().catch(() => undefined);
    throw new Error("the port has no stream to read or write");
  }
  return new SerialTransport(port, port.readable, port.writable);
}
