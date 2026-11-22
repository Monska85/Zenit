// SPDX-License-Identifier: GPL-3.0-or-later

// A board the test plays: the WebSocket the app opens is answered by FakeBoard (test/helpers.ts) instead of a
// simulator, so a test can make the board refuse, fall silent, ask for a login, or report what a screenshot needs.
// `MOCK_URL` is a board on WiFi (it answers `usb_only` to the commands reserved for USB); `MOCK_USB_URL` is the same
// board behind the fake serial port (e2e/fake-serial.ts).

import type { Page, WebSocketRoute } from "@playwright/test";
import { parseLine } from "../src/protocol/frame.ts";
import type { JsonObject } from "../src/protocol/strict-json.ts";
import { FakeBoard, lineOf } from "../test/helpers.ts";

export const MOCK_URL = "ws://zenit-mock.test/ws";
export const MOCK_USB_URL = "ws://zenit-usb.test/ws";

export interface Mock {
  board: FakeBoard;
  /** The commands the app sent, in order. */
  commands: () => string[];
  /** How long the board takes to answer a request, in ms; none by default. */
  delay: (request: JsonObject) => number;
  /** The board closes the connection, as when the power goes (with a close status when given, as 1013). */
  drop: (code?: number) => void;
  /** How many connections the app has opened to the board, over WiFi and over the serial port. */
  connections: () => number;
  /** Refuse the next connections (the board is restarting). */
  refuse: boolean;
}

/**
 * Answers the app's WebSocket to MOCK_URL and MOCK_USB_URL with `board`, and to `wifiUrls` too (the address a page served
 * by a board connects to: its own origin).
 */
export async function mockBoard(page: Page, board = new FakeBoard(), wifiUrls: string[] = []): Promise<Mock> {
  let count = 0;
  let open: WebSocketRoute | null = null;
  const mock: Mock = {
    board,
    commands: () => board.requests.map((request) => String(request["cmd"])),
    delay: () => 0,
    drop: (code) => void (code === undefined ? open?.close() : open?.close({ code, reason: "" })),
    connections: () => count,
    refuse: false,
  };
  const routes: Array<[string, "websocket" | "usb"]> = [
    [MOCK_URL, "websocket"],
    [MOCK_USB_URL, "usb"],
    ...wifiUrls.map((url): [string, "websocket"] => [url, "websocket"]),
  ];
  for (const [url, kind] of routes) {
    await page.routeWebSocket(url, (socket) => {
      count++;
      if (mock.refuse) {
        void socket.close({ code: 1011, reason: "restarting" });
        return;
      }
      open = socket;
      board.openConnection();
      socket.onMessage((message) => {
        if (typeof message !== "string") return;
        const request = parseLine(new TextEncoder().encode(message));
        if (!request) return;
        const replies = board.answer(request, kind).map((reply) => new TextDecoder().decode(lineOf(reply)));
        const code = board.takeClose();
        const wait = mock.delay(request);
        const send = (): void => {
          replies.forEach((line) => socket.send(line));
          if (code === 1000) setTimeout(() => void socket.close(), 20);
          else if (code !== null) setTimeout(() => void socket.close({ code, reason: "" }), 20);
        };
        if (wait > 0) setTimeout(send, wait);
        else send();
      });
    });
  }
  return mock;
}
