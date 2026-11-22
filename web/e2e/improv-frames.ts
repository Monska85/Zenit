// SPDX-License-Identifier: GPL-3.0-or-later

// The frames of conformance/improv/frames.json by name, as the hexadecimal digits the fake port plays, so the end-to-end
// tests script the board with the same hand-worked bytes the firmware's tests use.

import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Packet {
  name: string;
  hex: string;
}

const packets = (
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "conformance", "improv", "frames.json"), "utf8")) as {
    packets: Packet[];
  }
).packets;

/** The frame of the case called `name`, newline included. */
export function packet(name: string): string {
  const found = packets.find((entry) => entry.name === name);
  if (!found) throw new Error(`no Improv packet called ${name}`);
  return found.hex;
}

/** The RPC command of a frame the app wrote, as hexadecimal digits: the byte after the 7 header bytes and the type, length. */
export const rpcCommandOf = (frameHex: string): number => parseInt(frameHex.slice(18, 20), 16);
