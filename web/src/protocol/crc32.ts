// SPDX-License-Identifier: GPL-3.0-or-later

// CRC-32 as the protocol uses it: the zlib, PNG and Ethernet checksum (docs/protocol/protocol-v1.md#lines).

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 of `bytes`, as an unsigned 32-bit number. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A checksum as the 8 lowercase hexadecimal digits of a protocol line. */
export function crcHex(crc: number): string {
  return crc.toString(16).padStart(8, "0");
}
