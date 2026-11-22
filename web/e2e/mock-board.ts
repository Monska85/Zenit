// SPDX-License-Identifier: GPL-3.0-or-later

// A board the test plays: the WebSocket the app opens is answered by FakeBoard (test/helpers.ts) instead of a
// simulator, so a test can make the board refuse, fall silent, or report what a screenshot needs.

import type { Page, WebSocketRoute } from "@playwright/test";
import { parseLine } from "../src/protocol/frame.ts";
import type { JsonObject } from "../src/protocol/strict-json.ts";
import { FakeBoard, lineOf } from "../test/helpers.ts";

export const MOCK_URL = "ws://zenit-mock.test/ws";

export interface Mock {
  board: FakeBoard;
  /** The commands the app sent, in order. */
  commands: () => string[];
  /** How long the board takes to answer a request, in ms; none by default. */
  delay: (request: JsonObject) => number;
  /** The board closes the connection, as when the power goes. */
  drop: () => void;
}

/** Answers the app's WebSocket to MOCK_URL with `board`. */
export async function mockBoard(page: Page, board = new FakeBoard()): Promise<Mock> {
  const mock: Mock = {
    board,
    commands: () => board.requests.map((request) => String(request["cmd"])),
    delay: () => 0,
    drop: () => void (open as WebSocketRoute | null)?.close(),
  };
  let open: WebSocketRoute | null = null;
  await page.routeWebSocket(MOCK_URL, (socket) => {
    open = socket;
    socket.onMessage((message) => {
      if (typeof message !== "string") return;
      const request = parseLine(new TextEncoder().encode(message));
      if (!request) return;
      const replies = board.answer(request).map((reply) => new TextDecoder().decode(lineOf(reply)));
      const wait = mock.delay(request);
      const send = (): void => replies.forEach((line) => socket.send(line));
      if (wait > 0) setTimeout(send, wait);
      else send();
    });
  });
  return mock;
}
