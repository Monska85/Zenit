// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * What the client needs of a connection: lines in and out. A line is the bytes of one protocol line without its
 * newline. The transport adds the newline (USB serial) or sends it as one message (WebSocket).
 */
export interface LineTransport {
  readonly kind: "usb" | "websocket";
  /** Called with every line that arrives, protocol or not (the board's log lines come on USB). */
  onLine: ((line: Uint8Array) => void) | null;
  /** Called once when the connection ends, whoever ended it, with the cause when there is one. */
  onClose: ((cause?: Error) => void) | null;
  send(line: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
