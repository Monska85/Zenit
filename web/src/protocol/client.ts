// SPDX-License-Identifier: GPL-3.0-or-later

// The protocol client (docs/protocol/protocol-v1.md): the same rules as `Client` in tools/zenit.py. One request in
// flight, repeated until a valid reply with the same `seq` arrives, `info` first.

import { frameRequest, parseLine } from "./frame";
import { isBadFrameReply, isInt, isSeq, validBody } from "./schema";
import type { JsonObject } from "./strict-json";
import { toInfo, type BoardInfo } from "./types";
import { ConnectionClosed, type LineTransport } from "./transport";

export const REPLY_TIMEOUT_MS = 2000;
export const ATTEMPTS = 5;
export const SUPPORTED_PROTOCOL = 1;
/** Lines that arrive while no request waits (events, late replies) are kept up to this many, then the oldest go. */
const QUEUE_LIMIT = 64;

export type ClientFailure = "no_reply" | "closed" | "protocol";

/** The board could not be reached, or answered nothing usable. */
export class ClientError extends Error {
  constructor(
    readonly failure: ClientFailure,
    message: string,
    /** The WebSocket close status, when the board closed the connection with one (1008, 1013). */
    readonly closeCode?: number,
  ) {
    super(message);
  }
}

/** The board answered, with an error reply. */
export class BoardError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

class LineQueue {
  private lines: Uint8Array[] = [];
  private waiter: ((line: Uint8Array | null | ClientError) => void) | null = null;
  private ended: ClientError | null = null;

  push(line: Uint8Array): void {
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve(line);
      return;
    }
    this.lines.push(line);
    if (this.lines.length > QUEUE_LIMIT) this.lines.shift();
  }

  end(error: ClientError): void {
    this.ended = error;
    const resolve = this.waiter;
    this.waiter = null;
    resolve?.(error);
  }

  /** The next line, null when none arrives within `ms`; throws when the connection has ended. */
  next(ms: number): Promise<Uint8Array | null> {
    const line = this.lines.shift();
    if (line) return Promise.resolve(line);
    if (this.ended) return Promise.reject(this.ended);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        resolve(null);
      }, ms);
      this.waiter = (result) => {
        clearTimeout(timer);
        if (result instanceof ClientError) reject(result);
        else resolve(result);
      };
    });
  }
}

export interface ClientOptions {
  timeoutMs?: number;
  attempts?: number;
  /** The first `seq`; random when missing, so a new connection never looks like a retry of the last. */
  seq?: number;
}

function randomSeq(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! >>> 1;
}

export class Client {
  info: BoardInfo | null = null;
  /** Called once when the connection ends, with the reason, whoever ended it. */
  onEnd: ((error: ClientError) => void) | null = null;
  private readonly queue = new LineQueue();
  private readonly timeoutMs: number;
  private readonly attempts: number;
  private seq: number;
  private tail: Promise<unknown> = Promise.resolve();
  private waiting = 0;

  constructor(
    private readonly transport: LineTransport,
    options: ClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? REPLY_TIMEOUT_MS;
    this.attempts = options.attempts ?? ATTEMPTS;
    this.seq = options.seq ?? randomSeq();
    transport.onLine = (line) => this.queue.push(line);
    transport.onClose = (cause) => {
      const error = new ClientError(
        "closed",
        cause ? `the connection closed: ${cause.message}` : "the connection closed",
        cause instanceof ConnectionClosed ? cause.code : undefined,
      );
      this.onEnd?.(error);
      this.queue.end(error);
    };
  }

  get kind(): "usb" | "websocket" {
    return this.transport.kind;
  }

  /** The Improv side of the connection, when it has one (USB serial). */
  get improv(): LineTransport["improv"] {
    return this.transport.improv;
  }

  /** Whether a request is waiting its turn or for its reply. */
  get busy(): boolean {
    return this.waiting > 0;
  }

  /** Sends a request and returns its reply, an error reply included. Requests run one at a time, in order. */
  request(command: string, fields: Record<string, unknown> = {}): Promise<JsonObject> {
    if ("seq" in fields || "cmd" in fields) throw new TypeError("seq and cmd are not fields");
    this.waiting++;
    const run = this.tail.then(() => this.send(command, fields));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => this.waiting--);
  }

  /** Like `request`, but an error reply throws a BoardError. */
  async call(command: string, fields: Record<string, unknown> = {}): Promise<JsonObject> {
    const reply = await this.request(command, fields);
    if (reply["ok"] !== true) throw new BoardError(String(reply["error"]), String(reply["message"]));
    return reply;
  }

  /** `info` first, as the protocol asks, and a check of the protocol version. */
  async handshake(): Promise<BoardInfo> {
    const reply = await this.call("info");
    if (reply["protocol"] !== SUPPORTED_PROTOCOL) {
      throw new ClientError(
        "protocol",
        `the board speaks protocol ${String(reply["protocol"])}, this app protocol ${SUPPORTED_PROTOCOL}`,
      );
    }
    this.info = toInfo(reply);
    return this.info;
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  private async send(command: string, fields: Record<string, unknown>): Promise<JsonObject> {
    const seq = this.seq;
    this.seq = (this.seq + 1) % 2 ** 32;
    const line = frameRequest({ seq, cmd: command, ...fields });
    let malformed = false;
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      await this.transport.send(line).catch((error: unknown) => {
        throw new ClientError("closed", `cannot send: ${error instanceof Error ? error.message : String(error)}`);
      });
      const deadline = Date.now() + this.timeoutMs;
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const raw = await this.queue.next(remaining);
        if (raw === null) break;
        const reply = parseLine(raw);
        // A line to throw away, or an event this client does not know
        if (reply === null || (Object.hasOwn(reply, "event") && !Object.hasOwn(reply, "seq"))) continue;
        // The same seq, of the same JSON type: 1.0 is not 1
        if (isInt(reply["seq"]) && reply["seq"] === seq) {
          if (validBody(command, reply) && isSeq(reply["seq"])) return reply;
          malformed = true; // unusable: ask again
          continue;
        }
        // The board did not understand the line: send it again at once
        if (isBadFrameReply(reply)) break;
      }
    }
    throw new ClientError(
      "no_reply",
      `no reply to ${command} after ${this.attempts} tries${malformed ? " that was well formed" : ""}`,
    );
  }
}
