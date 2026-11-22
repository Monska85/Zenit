// SPDX-License-Identifier: GPL-3.0-or-later

/** The Improv Wi-Fi Serial frames of a connection that carries them next to the protocol lines (USB serial). */
export interface ImprovLink {
  /** Called with every complete Improv frame from the board that has a good checksum. */
  onFrame: ((type: number, data: Uint8Array) => void) | null;
  /** Sends one whole frame. */
  sendFrame(frame: Uint8Array): Promise<void>;
}

/** A connection that ended with a close code the app can explain (a WebSocket's: 1008, 1013). */
export class ConnectionClosed extends Error {
  constructor(
    readonly code: number,
    reason: string,
  ) {
    super(reason === "" ? `closed with status ${code}` : reason);
  }
}

/**
 * What the client needs of a connection: lines in and out. A line is the bytes of one protocol line without its
 * newline. The transport adds the newline (USB serial) or sends it as one message (WebSocket).
 */
export interface LineTransport {
  readonly kind: "usb" | "websocket";
  /** Present when the connection also speaks Improv (USB serial). */
  readonly improv?: ImprovLink;
  /** Called with every line that arrives, protocol or not (the board's log lines come on USB). */
  onLine: ((line: Uint8Array) => void) | null;
  /** Called once when the connection ends, whoever ended it, with the cause when there is one. */
  onClose: ((cause?: Error) => void) | null;
  send(line: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
