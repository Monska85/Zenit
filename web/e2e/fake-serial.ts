// SPDX-License-Identifier: GPL-3.0-or-later

// A Web Serial port for tests: `navigator.serial.requestPort` returns a port whose bytes travel over a WebSocket to
// `url`, which the test answers (mock-board.ts). It records how the port was used in `window.__serial`, and fails the
// test through that record when the app touches the control lines.

import type { Page } from "@playwright/test";

export interface SerialUse {
  requested: number;
  filters: unknown;
  openOptions: unknown;
  setSignals: number;
  closed: number;
}

/**
 * Makes the fake port speak Improv: a frame the app writes (it starts a line with `IMPROV` and the version byte) goes to
 * `respond` as hexadecimal digits instead of to the board, and the frames `respond` returns, as hexadecimal digits
 * too, come back as bytes of the port. Call it before the page opens.
 */
export async function scriptImprov(
  page: Page,
  respond: (frameHex: string) => string[] | Promise<string[]>,
): Promise<{ frames: () => string[] }> {
  const frames: string[] = [];
  await page.exposeFunction("__improv", async (hex: string) => {
    frames.push(hex);
    return await respond(hex);
  });
  return { frames: () => frames };
}

export async function installFakeSerial(page: Page, url: string): Promise<void> {
  await page.addInitScript((address) => {
    const use = { requested: 0, filters: null as unknown, openOptions: null as unknown, setSignals: 0, closed: 0 };
    (window as unknown as { __serial: typeof use }).__serial = use;
    const port = {
      readable: null as ReadableStream<Uint8Array> | null,
      controller: null as ReadableStreamDefaultController<Uint8Array> | null,
      writable: null as WritableStream<Uint8Array> | null,
      socket: null as WebSocket | null,
      async open(options: unknown) {
        use.openOptions = options;
        const socket = new WebSocket(address);
        this.socket = socket;
        await new Promise<void>((resolve, reject) => {
          socket.onopen = () => resolve();
          socket.onerror = () => reject(new Error("no board behind the fake port"));
        });
        const encoder = new TextEncoder();
        this.readable = new ReadableStream<Uint8Array>({
          start(controller) {
            port.controller = controller;
            // The board's log line comes first, as on a real port
            controller.enqueue(encoder.encode("zenit: firmware 1.2.3 on esp32c3\n"));
            socket.onmessage = (event) => controller.enqueue(encoder.encode(`${String(event.data)}\n`));
            socket.onclose = () => controller.close();
          },
        });
        this.writable = new WritableStream<Uint8Array>({
          async write(chunk) {
            // An Improv frame, after the newline the app puts before it: `IMPROV` and the version byte
            const body = chunk[0] === 0x0a ? chunk.subarray(1) : chunk;
            const marker = [0x49, 0x4d, 0x50, 0x52, 0x4f, 0x56, 0x01];
            const improv = (window as unknown as { __improv?: (hex: string) => Promise<string[]> }).__improv;
            if (improv && marker.every((byte, i) => body[i] === byte)) {
              const hex = Array.from(body, (byte) => byte.toString(16).padStart(2, "0")).join("");
              for (const reply of await improv(hex)) {
                const bytes = Uint8Array.from(reply.match(/../g) ?? [], (pair) => parseInt(pair, 16));
                port.controller?.enqueue(bytes);
              }
              return;
            }
            const text = new TextDecoder().decode(chunk);
            for (const line of text.split("\n")) if (line !== "") socket.send(line);
          },
        });
      },
      async close() {
        use.closed++;
        this.socket?.close();
      },
      setSignals() {
        use.setSignals++;
        return Promise.reject(new Error("setSignals must not be called"));
      },
    };
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        requestPort(options: { filters: unknown }) {
          use.requested++;
          use.filters = options.filters;
          return Promise.resolve(port);
        },
      },
    });
  }, url);
}

export const serialUse = (page: Page): Promise<SerialUse> =>
  page.evaluate(() => (window as unknown as { __serial: SerialUse }).__serial);
