// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";
import { probeServed, readBoardJson } from "../src/board/served";

const GOOD = '{"zenit":true,"hostname":"zenit-a1b2","ws":"/ws"}';

describe("readBoardJson", () => {
  it("accepts exactly the object a board serves", () => {
    expect(readBoardJson(GOOD)).toEqual({ hostname: "zenit-a1b2" });
    expect(readBoardJson('{"ws":"/ws","hostname":"zenit-0000","zenit":true}')).toEqual({ hostname: "zenit-0000" });
  });

  it.each([
    ["not JSON", "<!doctype html>"],
    ["an array", "[]"],
    ["null", "null"],
    ["an extra field", '{"zenit":true,"hostname":"zenit-a1b2","ws":"/ws","x":1}'],
    ["a missing field", '{"zenit":true,"hostname":"zenit-a1b2"}'],
    ["zenit not true", '{"zenit":"yes","hostname":"zenit-a1b2","ws":"/ws"}'],
    ["another ws path", '{"zenit":true,"hostname":"zenit-a1b2","ws":"//evil.test/ws"}'],
    ["an upper case hostname", '{"zenit":true,"hostname":"zenit-A1B2","ws":"/ws"}'],
    ["a long hostname", '{"zenit":true,"hostname":"zenit-a1b2c3","ws":"/ws"}'],
    ["another name", '{"zenit":true,"hostname":"printer-a1b2","ws":"/ws"}'],
    ["a hostname that is not text", '{"zenit":true,"hostname":1,"ws":"/ws"}'],
    ["a body that is too long", `{"zenit":true,"hostname":"zenit-a1b2","ws":"/ws","pad":"${"x".repeat(300)}"}`],
  ])("refuses %s", (_, text) => {
    expect(readBoardJson(text)).toBeNull();
  });
});

describe("probeServed", () => {
  const respond = (body: string, status = 200): typeof fetch =>
    vi.fn(() => Promise.resolve(new Response(body, { status }))) as unknown as typeof fetch;

  it("asks its own origin for /board.json without credentials or a cache", async () => {
    const fetcher = respond(GOOD);
    await expect(probeServed({ protocol: "http:", fetch: fetcher })).resolves.toEqual({ hostname: "zenit-a1b2" });
    expect(fetcher).toHaveBeenCalledWith(
      "/board.json",
      expect.objectContaining({ cache: "no-store", credentials: "omit", redirect: "error" }),
    );
  });

  it("makes no request from a page loaded over https", async () => {
    const fetcher = respond(GOOD);
    await expect(probeServed({ protocol: "https:", fetch: fetcher })).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("is not served when the answer is an error or another page", async () => {
    await expect(probeServed({ protocol: "http:", fetch: respond("Not found", 404) })).resolves.toBeNull();
    await expect(probeServed({ protocol: "http:", fetch: respond("<html></html>") })).resolves.toBeNull();
  });

  it("is not served when the request fails", async () => {
    const fetcher = vi.fn(() => Promise.reject(new TypeError("network"))) as unknown as typeof fetch;
    await expect(probeServed({ protocol: "http:", fetch: fetcher })).resolves.toBeNull();
  });

  it("gives up after the time limit", async () => {
    const fetcher = vi.fn(
      (_: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("x", "AbortError"))),
        ),
    ) as unknown as typeof fetch;
    await expect(probeServed({ protocol: "http:", fetch: fetcher }, 20)).resolves.toBeNull();
  });
});
