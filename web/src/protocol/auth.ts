// SPDX-License-Identifier: GPL-3.0-or-later

// The login of a WiFi client (docs/protocol/protocol-v1.md#authentication): the board sends a nonce, the client answers
// with the HMAC-SHA256 of the nonce under the token. The token itself never crosses the network.

import type { Client } from "./client";
import { hmacSha256, toHex } from "./sha256";

const encoder = new TextEncoder();

/** The token as the board makes it: 16 characters from `a-z` and `0-9`. */
export const TOKEN_PATTERN = /^[a-z0-9]{16}$/;

export const isToken = (text: string): boolean => TOKEN_PATTERN.test(text);

/** The `hmac` field of `auth`: 64 lowercase hexadecimal digits, the key the token's 16 ASCII bytes, the message the nonce's 32. */
export function authResponse(token: string, nonce: string): string {
  return toHex(hmacSha256(encoder.encode(token), encoder.encode(nonce)));
}

/** Runs `auth_challenge` and `auth`. Rejects with a BoardError `unauthorized` when the token is wrong. */
export async function login(client: Client, token: string): Promise<void> {
  const challenge = await client.call("auth_challenge");
  const nonce = challenge["nonce"];
  if (typeof nonce !== "string" || !/^[0-9a-f]{32}$/.test(nonce)) throw new TypeError("the board sent no usable nonce");
  await client.call("auth", { hmac: authResponse(token, nonce) });
}
