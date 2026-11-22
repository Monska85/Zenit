// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authResponse, isToken, login } from "../src/protocol/auth";
import { Client } from "../src/protocol/client";
import { fromHex, hmacSha256, sha256, toHex } from "../src/protocol/sha256";
import { FakeBoard, NONCE, TOKEN } from "./helpers";
import { createHmac } from "node:crypto";

interface HashCases {
  sha256: Array<{ hex_in: string; digest: string }>;
  hmac: Array<{ key_hex: string; message_hex: string; digest: string }>;
}

const cases = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "conformance", "net", "hash.json"), "utf8"),
) as HashCases;

describe("sha256 and hmacSha256", () => {
  it.each(cases.sha256.map((entry, index) => [index, entry] as const))("hashes conformance vector %i", (_, entry) => {
    expect(toHex(sha256(fromHex(entry.hex_in)))).toBe(entry.digest);
  });

  it.each(cases.hmac.map((entry, index) => [index, entry] as const))("signs conformance vector %i", (_, entry) => {
    expect(toHex(hmacSha256(fromHex(entry.key_hex), fromHex(entry.message_hex)))).toBe(entry.digest);
  });

  it("agrees with the platform for every length around a block boundary", () => {
    for (let length = 0; length <= 200; length++) {
      const data = Uint8Array.from({ length }, (_, i) => (i * 7 + length) & 0xff);
      const key = data.subarray(0, Math.min(length, 100));
      expect(toHex(hmacSha256(key, data))).toBe(createHmac("sha256", key).update(data).digest("hex"));
    }
  });

  it("round trips hexadecimal digits", () => {
    expect(toHex(fromHex("00ff10"))).toBe("00ff10");
    expect(fromHex("")).toEqual(new Uint8Array(0));
  });
});

describe("the login", () => {
  it("answers a nonce with the HMAC of its characters under the token's characters", () => {
    expect(authResponse(TOKEN, NONCE)).toBe(createHmac("sha256", TOKEN).update(NONCE).digest("hex"));
    expect(authResponse(TOKEN, NONCE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("knows a token when it sees one", () => {
    expect(isToken("abcdefghij012345")).toBe(true);
    for (const bad of ["", "ABCDEFGHIJ012345", "abcdefghij01234", "abcdefghij0123456", "abcdefghij01234!"])
      expect(isToken(bad)).toBe(false);
  });

  it("sends auth_challenge, then auth with the answer", async () => {
    const board = new FakeBoard().withNetwork();
    const transport = board.transport();
    const client = new Client(transport);
    await login(client, TOKEN);
    expect(board.requests.map((request) => request["cmd"])).toEqual(["auth_challenge", "auth"]);
    expect(board.requests[1]?.["hmac"]).toBe(authResponse(TOKEN, NONCE));
  });

  it("rejects with unauthorized for a wrong token", async () => {
    const board = new FakeBoard().withNetwork();
    const client = new Client(board.transport());
    await expect(login(client, "zzzzzzzzzzzzzzzz")).rejects.toMatchObject({ code: "unauthorized" });
  });
});
