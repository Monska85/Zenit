// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { crc32, crcHex } from "../src/protocol/crc32";
import { text } from "./helpers";

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crcHex(crc32(text("123456789")))).toBe("cbf43926");
  });

  it("is zero for no bytes", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("matches the info request of the specification", () => {
    expect(crcHex(crc32(text('{"seq":1,"cmd":"info"}')))).toBe("3c250228");
  });

  it("covers every byte, including those above 127", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(crcHex(crc32(bytes))).toBe("29058c73");
  });

  it("writes eight lowercase digits, with leading zeros", () => {
    expect(crcHex(0x1f)).toBe("0000001f");
    expect(crcHex(0xffffffff)).toBe("ffffffff");
  });
});
