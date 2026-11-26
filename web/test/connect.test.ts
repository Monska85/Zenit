// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
  addressOpener,
  LOCAL_ADDRESS_MESSAGE,
  MIXED_CONTENT_MESSAGE,
  UNREACHABLE_FROM_SITE,
  type AddressEnvironment,
} from "../src/board/connect";
import { OpenFailed } from "../src/board/session";
import type { LocalPermission } from "../src/protocol/address";
import type { LineTransport } from "../src/protocol/transport";

/** The published site in a browser with Local Network Access, recording what the opener asks the socket for. */
function site(permission: LocalPermission, overrides: Partial<AddressEnvironment> = {}) {
  const opened: Array<{ url: string; timeoutMs: number }> = [];
  const asked: string[] = [];
  const environment: AddressEnvironment = {
    protocol: "https:",
    hostname: "monska85.github.io",
    localNetworkAccess: true,
    permission: (hostname) => {
      asked.push(hostname);
      return Promise.resolve(permission);
    },
    open: (url, timeoutMs) => {
      opened.push({ url, timeoutMs });
      return Promise.resolve({} as LineTransport);
    },
    ...overrides,
  };
  return { environment, opened, asked };
}

async function openWith(typed: string, environment: AddressEnvironment): Promise<void> {
  const opener = addressOpener(typed, environment);
  if (typeof opener === "string") throw new Error(opener);
  await opener(true);
}

describe("addressOpener", () => {
  it("gives the socket 60 seconds while the browser may still ask about the local network", async () => {
    for (const permission of ["prompt", "unknown"] as const) {
      const { environment, opened, asked } = site(permission);
      await openWith("zenit-1a2b.local", environment);
      expect(asked).toEqual(["zenit-1a2b.local"]);
      expect(opened).toEqual([{ url: "ws://zenit-1a2b.local/ws", timeoutMs: 60_000 }]);
    }
  });

  it("gives the simulator on this computer the same window, since the browser asks about it too", async () => {
    const { environment, opened } = site("prompt");
    await openWith("ws://127.0.0.1:8765", environment);
    expect(opened).toEqual([{ url: "ws://127.0.0.1:8765", timeoutMs: 60_000 }]);
  });

  it("keeps 5 seconds once the permission is answered", async () => {
    for (const permission of ["granted", "denied"] as const) {
      const { environment, opened } = site(permission);
      await openWith("192.168.1.20", environment);
      expect(opened).toEqual([{ url: "ws://192.168.1.20/ws", timeoutMs: 5000 }]);
    }
  });

  it("reads no permission where the browser cannot ask: an encrypted socket, a local page, no Local Network Access", async () => {
    for (const [typed, overrides] of [
      ["wss://zenit.example/ws", {}],
      ["192.168.1.20", { hostname: "localhost" }],
      ["ws://127.0.0.1:8765", { localNetworkAccess: false, hostname: "localhost" }],
    ] as const) {
      const { environment, asked, opened } = site("prompt", overrides);
      await openWith(typed, environment);
      expect(asked).toEqual([]);
      expect(opened[0]?.timeoutMs).toBe(5000);
    }
  });

  it("keeps 5 seconds and asks nothing on a page that is not secure", async () => {
    const { environment, opened, asked } = site("prompt", { protocol: "http:", hostname: "zenit-1a2b.local" });
    await openWith("zenit-1a2b.local", environment);
    expect(asked).toEqual([]);
    expect(opened).toEqual([{ url: "ws://zenit-1a2b.local/ws", timeoutMs: 5000 }]);
  });

  it("refuses a name outside the local network, and every address in a browser without Local Network Access", () => {
    expect(addressOpener("zenit.lan", site("prompt").environment)).toBe(LOCAL_ADDRESS_MESSAGE);
    expect(addressOpener("192.168.1.20", site("prompt", { localNetworkAccess: false }).environment)).toBe(
      MIXED_CONTENT_MESSAGE,
    );
  });

  it("says to allow the permission when a connection from the site fails", async () => {
    const { environment } = site("prompt", { open: () => Promise.reject(new Error("closed")) });
    const opener = addressOpener("192.168.1.20", environment);
    if (typeof opener === "string") throw new Error(opener);
    await expect(opener(true)).rejects.toEqual(new OpenFailed(UNREACHABLE_FROM_SITE));
  });
});
