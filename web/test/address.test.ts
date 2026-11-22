// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { addressUnavailableHere, boardUrl, mixedContentBlocked } from "../src/protocol/address";

describe("boardUrl", () => {
  it.each([
    ["zenit-1a2b.local", "ws://zenit-1a2b.local/ws"],
    ["  192.168.1.20 ", "ws://192.168.1.20/ws"],
    ["192.168.1.20:8080", "ws://192.168.1.20:8080/ws"],
    ["localhost:8765", "ws://localhost:8765/ws"],
    ["[::1]", "ws://[::1]/ws"],
    ["[fe80::1]:81", "ws://[fe80::1]:81/ws"],
    ["ws://127.0.0.1:8765", "ws://127.0.0.1:8765"],
    ["wss://zenit.example/ws", "wss://zenit.example/ws"],
    ["ws://zenit-1a2b.local/ws", "ws://zenit-1a2b.local/ws"],
  ])("turns %s into %s", (typed, url) => {
    expect(boardUrl(typed)).toEqual({ url });
  });

  it.each([
    "",
    "   ",
    "http://zenit.local",
    "https://zenit.local/ws",
    "ftp://x",
    "ws://",
    "ws://user:pass@zenit.local",
    "zenit local",
    "zenit.local:0",
    "zenit.local:70000",
    "zenit.local:abc",
    "zenit.local/ws",
    "-bad.local",
    "bad-.local",
    "a..b",
    "javascript:alert(1)",
    "a b:80",
  ])("refuses %j with a sentence", (typed) => {
    const result = boardUrl(typed);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/\.$/);
  });
});

describe("mixedContentBlocked", () => {
  it("blocks an unencrypted socket to another computer from a secure page", () => {
    expect(mixedContentBlocked("https:", "ws://zenit-1a2b.local/ws")).toBe(true);
    expect(mixedContentBlocked("https:", "ws://192.168.1.20/ws")).toBe(true);
  });

  it("lets the same computer through", () => {
    expect(mixedContentBlocked("https:", "ws://127.0.0.1:8765")).toBe(false);
    expect(mixedContentBlocked("https:", "ws://localhost:8765/ws")).toBe(false);
    expect(mixedContentBlocked("https:", "ws://[::1]:8765")).toBe(false);
  });

  it("lets an encrypted socket through, and any socket from a page that is not secure", () => {
    expect(mixedContentBlocked("https:", "wss://zenit.example/ws")).toBe(false);
    expect(mixedContentBlocked("http:", "ws://192.168.1.20/ws")).toBe(false);
  });
});

describe("addressUnavailableHere", () => {
  it("is true on a secure page of another site, where only USB reaches a Zenit", () => {
    expect(addressUnavailableHere("https:", "monska85.github.io")).toBe(true);
    expect(addressUnavailableHere("https:", "192.168.1.5")).toBe(true);
  });

  it("is false on this computer, and on a page that is not secure", () => {
    expect(addressUnavailableHere("https:", "localhost")).toBe(false);
    expect(addressUnavailableHere("https:", "127.0.0.1")).toBe(false);
    expect(addressUnavailableHere("https:", "[::1]")).toBe(false);
    expect(addressUnavailableHere("http:", "zenit-1a2b.local")).toBe(false);
    expect(addressUnavailableHere("http:", "monska85.github.io")).toBe(false);
  });
});
