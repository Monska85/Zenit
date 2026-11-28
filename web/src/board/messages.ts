// SPDX-License-Identifier: GPL-3.0-or-later

// The sentences people read when something goes wrong (docs/web/web-app-v1.md#errors), as messages of the `errors`
// catalog: translated where they are shown.

import { message, type Message, type MessageKey } from "../i18n";
import { own } from "../lib/own";
import { BoardError, ClientError } from "../protocol/client";

const BOARD_ERRORS: Record<string, MessageKey> = {
  bad_request: "errors:board.bad_request",
  unknown_command: "errors:board.unknown_command",
  storage_error: "errors:board.storage_error",
  usb_only: "errors:board.usb_only",
  busy: "errors:board.busy",
  unauthorized: "errors:board.unauthorized",
  no_network: "errors:board.no_network",
  updates_off: "errors:board.updates_off",
  nothing_to_install: "errors:board.nothing_to_install",
  favorites_full: "errors:board.favorites_full",
  unknown_favorite: "errors:board.unknown_favorite",
  bad_name: "errors:board.bad_name",
  name_taken: "errors:board.name_taken",
};

/** The WebSocket close statuses the board uses on purpose (docs/board/wifi-and-updates-v1.md#websocket). */
export const CLOSE_MESSAGES: Record<number, Message> = {
  1008: message("errors:closed.1008"),
  1013: message("errors:closed.1013"),
};

export const NO_ANSWER = message("errors:noAnswer");

export const NEWER_PROTOCOL = message("errors:newerProtocol");
export const INVALID_REPLY = message("errors:invalidReply");

/** The message for a failed request. The board's own message is for logs and is never shown. */
export function errorMessage(error: unknown): Message {
  if (error instanceof BoardError) {
    const key = own(BOARD_ERRORS, error.code);
    return key === undefined ? message("errors:refused", { code: error.code }) : message(key);
  }
  if (error instanceof ClientError) {
    if (error.failure === "protocol") return NEWER_PROTOCOL;
    if (error.failure === "invalid_reply") return INVALID_REPLY;
    const closed = error.failure === "closed" && error.closeCode !== undefined;
    return (closed ? own(CLOSE_MESSAGES, error.closeCode as number) : undefined) ?? NO_ANSWER;
  }
  return message("errors:unknown");
}
