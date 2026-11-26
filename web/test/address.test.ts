// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
  addressUnavailableHere,
  boardUrl,
  connectTimeoutFor,
  localHost,
  localNetworkAccessFor,
  mixedContentBlocked,
  PERMISSION_CONNECT_TIMEOUT_MS,
  permissionNameFor,
  PRIVATE_ONLY_MESSAGE,
} from "../src/protocol/address";
import { CONNECT_TIMEOUT_MS } from "../src/protocol/websocket";

describe("boardUrl", () => {
  it.each([
    ["zenit-1a2b.local", "ws://zenit-1a2b.local/ws"],
    ["  192.168.1.20 ", "ws://192.168.1.20/ws"],
    ["192.168.1.20:8080", "ws://192.168.1.20:8080/ws"],
    ["localhost:8765", "ws://localhost:8765/ws"],
    ["[::1]", "ws://[::1]/ws"],
    ["[fe80::1]:81", "ws://[fe80::1]:81/ws"],
    ["ws://127.0.0.1:8765", "ws://127.0.0.1:8765"],
    ["[fd12:3456::1]:8080", "ws://[fd12:3456::1]:8080/ws"],
    ["169.254.10.20", "ws://169.254.10.20/ws"],
    ["172.31.0.1", "ws://172.31.0.1/ws"],
    ["ws://127.0.0.2:9000/ws", "ws://127.0.0.2:9000/ws"],
    ["ws://[::1]:8765", "ws://[::1]:8765"],
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

  it("refuses an encrypted address: a Zenit has none", () => {
    expect(boardUrl("wss://zenit-1a2b.local/ws")).toEqual({ error: "The address must start with ws://." });
  });

  it.each([
    "8.8.8.8",
    "203.0.113.5:8765",
    "172.32.0.1",
    "172.15.255.255",
    "192.169.1.1",
    "169.255.0.1",
    "11.0.0.1",
    "ws://134744072/ws",
    "ws://0x08080808/ws",
    "zenit",
    "zenit-1a2b",
    "zenit.lan",
    "zenit.example.com",
    "local",
    "localhost.example.com",
    "zenit.local.example.com",
    "[2001:db8::1]",
    "[::ffff:192.168.1.20]",
    "[fbff::1]",
    "[fec0::1]",
    "ws://zenit.example/ws",
  ])("refuses %j: it is not on this computer or the local network", (typed) => {
    expect(boardUrl(typed)).toEqual({ error: PRIVATE_ONLY_MESSAGE });
  });

  it("reads other spellings of a local IPv4 address the way the browser does", () => {
    expect(boardUrl("ws://0x7f.1:8765/ws")).toEqual({ url: "ws://0x7f.1:8765/ws" });
    // 192.168.1.20 and 8.8.8.8 written as one number
    expect(boardUrl("ws://3232235796/ws")).toEqual({ url: "ws://3232235796/ws" });
    expect(boardUrl("134744072")).toEqual({ error: PRIVATE_ONLY_MESSAGE });
  });

  it("names the forms it accepts in its sentence", () => {
    expect(PRIVATE_ONLY_MESSAGE).toContain(".local");
    expect(PRIVATE_ONLY_MESSAGE).toContain("192.168.1.20");
    expect(PRIVATE_ONLY_MESSAGE).toContain("ws://127.0.0.1:8765");
  });
});

describe("localHost", () => {
  it.each([
    "localhost",
    "127.0.0.1",
    "[::1]",
    "zenit-a1b2.local",
    "ZENIT-A1B2.LOCAL",
    "zenit-a1b2.local.",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.20",
    "169.254.10.1",
    "[fe80::1]",
    "fe80::1",
    "[febf::1]",
    "[fc00::1]",
    "[fd12:3456::1]",
    "::1",
  ])("%s is on the local network", (host) => expect(localHost(host)).toBe(true));

  it.each([
    "zenit",
    "zenit.lan",
    "zenit.example",
    "local",
    "notlocal",
    "8.8.8.8",
    "172.15.0.1",
    "172.32.0.1",
    "192.169.1.1",
    "11.0.0.1",
    "192.168.1",
    "192.168.1.256",
    "169.255.10.1",
    "[fec0::1]",
    "[fe7f::1]",
    "[fbff::1]",
    "[2001:db8::1]",
    "[::]",
    "[::ffff:c0a8:114]",
  ])("%s is not", (host) => expect(localHost(host)).toBe(false));
});

describe("mixedContentBlocked", () => {
  it("blocks an unencrypted socket to another computer from a secure page without Local Network Access", () => {
    expect(mixedContentBlocked("https:", "ws://zenit-1a2b.local/ws", false)).toBe(true);
    expect(mixedContentBlocked("https:", "ws://192.168.1.20/ws", false)).toBe(true);
  });

  it("lets a .local name or a private address through with Local Network Access", () => {
    expect(mixedContentBlocked("https:", "ws://zenit-1a2b.local/ws", true)).toBe(false);
    expect(mixedContentBlocked("https:", "ws://192.168.1.20/ws", true)).toBe(false);
    expect(mixedContentBlocked("https:", "ws://10.0.0.5:8080/ws", true)).toBe(false);
  });

  it("blocks other names and public addresses even with Local Network Access", () => {
    expect(mixedContentBlocked("https:", "ws://zenit/ws", true)).toBe(true);
    expect(mixedContentBlocked("https:", "ws://zenit.lan/ws", true)).toBe(true);
    expect(mixedContentBlocked("https:", "ws://8.8.8.8/ws", true)).toBe(true);
  });

  it("lets the same computer through", () => {
    for (const lna of [false, true]) {
      expect(mixedContentBlocked("https:", "ws://127.0.0.1:8765", lna)).toBe(false);
      expect(mixedContentBlocked("https:", "ws://localhost:8765/ws", lna)).toBe(false);
      expect(mixedContentBlocked("https:", "ws://[::1]:8765", lna)).toBe(false);
    }
  });

  it("lets an encrypted socket through, and any socket from a page that is not secure", () => {
    expect(mixedContentBlocked("http:", "ws://192.168.1.20/ws", false)).toBe(false);
    expect(mixedContentBlocked("http:", "ws://zenit/ws", true)).toBe(false);
  });
});

describe("addressUnavailableHere", () => {
  it("is true on a secure page of another site in a browser without Local Network Access", () => {
    expect(addressUnavailableHere("https:", "monska85.github.io", false)).toBe(true);
    expect(addressUnavailableHere("https:", "192.168.1.5", false)).toBe(true);
  });

  it("is false with Local Network Access, on this computer, and on a page that is not secure", () => {
    expect(addressUnavailableHere("https:", "monska85.github.io", true)).toBe(false);
    expect(addressUnavailableHere("https:", "localhost", false)).toBe(false);
    expect(addressUnavailableHere("https:", "127.0.0.1", false)).toBe(false);
    expect(addressUnavailableHere("https:", "[::1]", false)).toBe(false);
    expect(addressUnavailableHere("http:", "zenit-1a2b.local", false)).toBe(false);
    expect(addressUnavailableHere("http:", "monska85.github.io", false)).toBe(false);
  });
});

describe("localNetworkAccessFor", () => {
  const brands = (version: string) => [
    { brand: "Google Chrome", version },
    { brand: "Not/A)Brand", version: "8" },
    { brand: "Chromium", version },
  ];

  it("is true for Chromium 147 and later", () => {
    expect(localNetworkAccessFor(brands("147"))).toBe(true);
    expect(localNetworkAccessFor(brands("159"))).toBe(true);
  });

  it("is false for older Chromium, a browser without the Chromium brand, and no brands at all", () => {
    expect(localNetworkAccessFor(brands("146"))).toBe(false);
    expect(localNetworkAccessFor([{ brand: "Firefox", version: "200" }])).toBe(false);
    expect(localNetworkAccessFor([])).toBe(false);
    expect(localNetworkAccessFor(undefined)).toBe(false);
  });

  it("is false for a version that is not a whole number", () => {
    expect(localNetworkAccessFor([{ brand: "Chromium", version: "147.0" }])).toBe(false);
    expect(localNetworkAccessFor([{ brand: "Chromium", version: "" }])).toBe(false);
  });
});

describe("connectTimeoutFor", () => {
  const SITE = "monska85.github.io";

  it("waits longer from a secure page of another site to the local network or this computer while the browser may ask", () => {
    for (const permission of ["prompt", "unknown"] as const) {
      expect(connectTimeoutFor("https:", SITE, "ws://zenit-1a2b.local/ws", permission)).toBe(
        PERMISSION_CONNECT_TIMEOUT_MS,
      );
      expect(connectTimeoutFor("https:", SITE, "ws://192.168.1.20/ws", permission)).toBe(PERMISSION_CONNECT_TIMEOUT_MS);
      expect(connectTimeoutFor("https:", SITE, "ws://127.0.0.1:8765", permission)).toBe(PERMISSION_CONNECT_TIMEOUT_MS);
    }
  });

  it("keeps the normal window once the permission is answered, and everywhere else", () => {
    expect(connectTimeoutFor("https:", SITE, "ws://192.168.1.20/ws", "granted")).toBe(CONNECT_TIMEOUT_MS);
    expect(connectTimeoutFor("https:", SITE, "ws://192.168.1.20/ws", "denied")).toBe(CONNECT_TIMEOUT_MS);
    expect(connectTimeoutFor("https:", SITE, "ws://zenit.example/ws", "prompt")).toBe(CONNECT_TIMEOUT_MS);
    expect(connectTimeoutFor("https:", "localhost", "ws://192.168.1.20/ws", "prompt")).toBe(CONNECT_TIMEOUT_MS);
    expect(connectTimeoutFor("http:", "zenit-1a2b.local", "ws://zenit-1a2b.local/ws", "prompt")).toBe(
      CONNECT_TIMEOUT_MS,
    );
  });
});

describe("permissionNameFor", () => {
  it("asks about loopback for this computer and about the local network otherwise, never the older name", () => {
    expect(permissionNameFor("127.0.0.1")).toBe("loopback-network");
    expect(permissionNameFor("[::1]")).toBe("loopback-network");
    expect(permissionNameFor("localhost")).toBe("loopback-network");
    expect(permissionNameFor("zenit-1a2b.local")).toBe("local-network");
    expect(permissionNameFor("192.168.1.20")).toBe("local-network");
  });
});
