// SPDX-License-Identifier: GPL-3.0-or-later

// The WebSocket of a board on WiFi or of the simulator: one text message is one line.

import { MAX_REPLY_LINE } from "./frame";
import type { LineTransport } from "./transport";

/** The part of the WebSocket API the transport uses, so a test can stand in for it. */
export interface SocketLike {
  binaryType: string;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  send(data: string): void;
  close(): void;
}

export type SocketFactory = (url: string) => SocketLike;

export const CONNECT_TIMEOUT_MS = 5000;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

class WebSocketTransport implements LineTransport {
  readonly kind = "websocket";
  onLine: ((line: Uint8Array) => void) | null = null;
  onClose: ((cause?: Error) => void) | null = null;
  private closed = false;

  constructor(private readonly socket: SocketLike) {
    socket.onmessage = (event) => {
      // A binary message is not ours, and neither is a line over the limit.
      if (typeof event.data !== "string") return;
      const line = encoder.encode(event.data);
      if (line.length <= MAX_REPLY_LINE) this.onLine?.(line);
    };
    socket.onclose = (event) => this.finish(event.reason ? new Error(event.reason) : undefined);
    socket.onerror = () => undefined;
  }

  private finish(cause?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose?.(cause);
  }

  send(line: Uint8Array): Promise<void> {
    try {
      this.socket.send(decoder.decode(line));
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  close(): Promise<void> {
    this.socket.close();
    this.finish();
    return Promise.resolve();
  }
}

/** Opens `url` and resolves once the connection is up, or rejects after `timeoutMs`. */
export function openWebSocket(
  url: string,
  factory: SocketFactory = (address) => new WebSocket(address) as unknown as SocketLike,
  timeoutMs = CONNECT_TIMEOUT_MS,
): Promise<LineTransport> {
  return new Promise((resolve, reject) => {
    let socket: SocketLike;
    try {
      socket = factory(url);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const failed = (message: string): void => {
      clearTimeout(timer);
      socket.onopen = socket.onclose = socket.onerror = null;
      try {
        socket.close();
      } catch {
        // already closed
      }
      reject(new Error(message));
    };
    const timer = setTimeout(() => failed("the connection did not open in time"), timeoutMs);
    socket.onopen = () => {
      clearTimeout(timer);
      socket.onerror = null;
      resolve(new WebSocketTransport(socket));
    };
    socket.onerror = () => failed("the connection failed");
    socket.onclose = () => failed("the connection was refused or closed");
  });
}
