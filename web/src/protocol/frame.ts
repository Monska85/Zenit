// SPDX-License-Identifier: GPL-3.0-or-later

// Lines of the protocol: `@ZN <crc> <json>` (docs/protocol/protocol-v1.md#lines).

import { crc32, crcHex } from "./crc32";
import { JsonError, parseStrictObject, type JsonObject } from "./strict-json";

const encoder = new TextEncoder();
const MARKER = encoder.encode("@ZN ");
const DIGITS = 8;

/** The longest reply line the client accepts (docs/protocol/protocol-v1.md#limits); the board sends far less. */
export const MAX_REPLY_LINE = 4096;

/** The line for a request, without the newline: the marker, the checksum of the JSON bytes, and the JSON. */
export function frameRequest(request: Record<string, unknown>): Uint8Array {
  const body = encoder.encode(JSON.stringify(request));
  const head = encoder.encode(`@ZN ${crcHex(crc32(body))} `);
  const line = new Uint8Array(head.length + body.length);
  line.set(head);
  line.set(body, head.length);
  return line;
}

function isLowerHex(byte: number): boolean {
  return (byte >= 0x30 && byte <= 0x39) || (byte >= 0x61 && byte <= 0x66);
}

/**
 * The JSON object of a protocol line, or null for anything else: a log line, a line with a bad checksum, JSON that
 * breaks the protocol's rules. The client throws these away. A trailing `\n`, and one `\r` before it, are ignored.
 */
export function parseLine(raw: Uint8Array): JsonObject | null {
  let end = raw.length;
  if (end > 0 && raw[end - 1] === 0x0a) end--;
  if (end > 0 && raw[end - 1] === 0x0d) end--;
  const bodyAt = MARKER.length + DIGITS + 1;
  if (end < bodyAt || !MARKER.every((byte, i) => raw[i] === byte) || raw[MARKER.length + DIGITS] !== 0x20) return null;
  let crc = 0;
  for (let i = MARKER.length; i < MARKER.length + DIGITS; i++) {
    const byte = raw[i] as number;
    if (!isLowerHex(byte)) return null;
    crc = crc * 16 + parseInt(String.fromCharCode(byte), 16);
  }
  const body = raw.subarray(bodyAt, end);
  if (crc32(body) !== crc) return null;
  try {
    return parseStrictObject(body);
  } catch (error) {
    if (error instanceof JsonError) return null;
    throw error;
  }
}
