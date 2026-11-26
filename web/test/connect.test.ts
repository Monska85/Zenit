// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
  addressOpener,
  connectAddress,
  MIXED_CONTENT_MESSAGE,
  UNREACHABLE_FROM_SITE,
  usbOpener,
  type AddressEnvironment,
  type SerialApi,
} from "../src/board/connect";
import { BoardSession, OpenFailed } from "../src/board/session";
import { PRIVATE_ONLY_MESSAGE, type LocalPermission } from "../src/protocol/address";
import { ESPRESSIF_VENDOR_ID, type SerialPortLike } from "../src/protocol/serial";
import type { LineTransport } from "../src/protocol/transport";
import { FakeBoard } from "./helpers";

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
    expect(addressOpener("zenit.lan", site("prompt").environment)).toBe(PRIVATE_ONLY_MESSAGE);
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

/** A port that opens or not, as the test says, with streams that carry nothing. */
class Port implements SerialPortLike {
  opens = true;
  opened = 0;
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  constructor(private readonly vendor = ESPRESSIF_VENDOR_ID) {}
  open(): Promise<void> {
    if (!this.opens) return Promise.reject(new Error("not there"));
    this.opened++;
    this.readable = new ReadableStream<Uint8Array>();
    this.writable = new WritableStream<Uint8Array>();
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  getInfo(): { usbVendorId?: number } {
    return { usbVendorId: this.vendor };
  }
}

function serial(chosen: Port, granted: Port[] = [chosen]) {
  const calls = { request: 0 };
  const api: SerialApi = {
    requestPort: () => {
      calls.request++;
      return Promise.resolve(chosen);
    },
    getPorts: () => Promise.resolve(granted),
  };
  return { api: () => api, calls };
}

describe("usbOpener", () => {
  it("keeps the port through tries the page makes by itself, and opens it once it is back", async () => {
    const port = new Port();
    const { api, calls } = serial(port, []);
    const opener = usbOpener(api);
    await opener(true);
    port.opens = false;
    for (let i = 0; i < 3; i++) await expect(opener(false)).rejects.toBeInstanceOf(OpenFailed);
    port.opens = true;
    await expect(opener(false)).resolves.toBeTruthy();
    expect(port.opened).toBe(2);
    expect(calls.request).toBe(1);
  });

  it("falls back to the one granted Espressif port when the browser gives a new port object", async () => {
    const first = new Port();
    const again = new Port();
    const { api } = serial(first, [again, new Port(0x1234)]);
    const opener = usbOpener(api);
    await opener(true);
    first.opens = false;
    await expect(opener(false)).resolves.toBeTruthy();
    expect(again.opened).toBe(1);
  });

  it("does not guess between two granted Espressif ports", async () => {
    const first = new Port();
    const { api } = serial(first, [new Port(), new Port()]);
    const opener = usbOpener(api);
    await opener(true);
    first.opens = false;
    await expect(opener(false)).rejects.toBeInstanceOf(OpenFailed);
  });

  it("asks again on a click when the port it had does not open", async () => {
    const port = new Port();
    const { api, calls } = serial(port);
    const opener = usbOpener(api);
    await opener(true);
    port.opens = false;
    await expect(opener(true)).rejects.toBeInstanceOf(OpenFailed);
    expect(calls.request).toBe(2);
  });
});

describe("connectAddress", () => {
  const local = (open: AddressEnvironment["open"]): AddressEnvironment => ({
    protocol: "http:",
    hostname: "localhost",
    localNetworkAccess: false,
    permission: () => Promise.resolve("unknown"),
    open,
  });

  it("says the address was reached only when the board answered", async () => {
    const session = new BoardSession();
    const board = new FakeBoard();
    const reached = await connectAddress(
      session,
      " 192.168.1.20 ",
      local(() => Promise.resolve(board.transport())),
    );
    expect(reached).toEqual({ problem: null, reached: true });
    await session.disconnect();
    const failed = await connectAddress(
      session,
      "192.168.1.21",
      local(() => Promise.reject(new Error("no"))),
    );
    expect(failed).toEqual({ problem: null, reached: false });
    expect(session.getState().error).not.toBeNull();
  });

  it("gives the sentence of an address it refuses", async () => {
    const result = await connectAddress(
      new BoardSession(),
      "8.8.8.8",
      local(() => Promise.reject(new Error("no"))),
    );
    expect(result).toEqual({ problem: PRIVATE_ONLY_MESSAGE, reached: false });
  });
});
