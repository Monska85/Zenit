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

export async function installFakeSerial(page: Page, url: string): Promise<void> {
  await page.addInitScript((address) => {
    const use = { requested: 0, filters: null as unknown, openOptions: null as unknown, setSignals: 0, closed: 0 };
    (window as unknown as { __serial: typeof use }).__serial = use;
    const port = {
      readable: null as ReadableStream<Uint8Array> | null,
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
            // The board's log line comes first, as on a real port
            controller.enqueue(encoder.encode("zenit: firmware 1.2.3 on esp32c3\n"));
            socket.onmessage = (event) => controller.enqueue(encoder.encode(`${String(event.data)}\n`));
            socket.onclose = () => controller.close();
          },
        });
        this.writable = new WritableStream<Uint8Array>({
          write(chunk) {
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
