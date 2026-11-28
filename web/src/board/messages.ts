// SPDX-License-Identifier: GPL-3.0-or-later

// The sentences people read when something goes wrong (docs/web/web-app-v1.md#errors).

import { own } from "../lib/own";
import { BoardError, ClientError } from "../protocol/client";

const BOARD_ERRORS: Record<string, string> = {
  bad_request: "Zenit did not accept that value.",
  unknown_command: "This Zenit firmware is too old for that. Update the firmware on the Device page.",
  storage_error: "Zenit could not save that. Nothing was changed.",
  usb_only: "This works only with a USB cable.",
  busy: "Zenit is busy. Try again in a moment.",
  unauthorized: "Zenit needs the access token first.",
  no_network: "Zenit is not connected to WiFi.",
  updates_off: "Updates are turned off. Turn them on in the Device page.",
  nothing_to_install: "There is no update to install. Check for updates first.",
  favorites_full: "Your favorites are full. Delete one first.",
  unknown_favorite: "That favorite is no longer on Zenit.",
  bad_name: "Zenit did not accept that name.",
  name_taken: "You already have a favorite with that name.",
};

/** The sentence for an error code of the board, or undefined for one this app has no sentence for. */
export const errorSentence = (code: string): string | undefined => own(BOARD_ERRORS, code);

/** The WebSocket close statuses the board uses on purpose (docs/board/wifi-and-updates-v1.md#websocket). */
export const CLOSE_MESSAGES: Record<number, string> = {
  1008: "Zenit closed the connection: the access token was wrong three times, or this page is not allowed to connect.",
  1013: "Another page or phone is already connected to this Zenit. Close it, then connect again.",
};

export const NO_ANSWER = "Zenit did not answer. Check the cable or the address.";

export const NEWER_PROTOCOL = "This Zenit speaks a newer protocol than this app. Reload the app, or update it.";
export const INVALID_REPLY = "Zenit sent something this app cannot show. Update the firmware on the Device page.";

/** The sentence for a failed request. The board's own message is for logs and is never shown. */
export function describeError(error: unknown): string {
  if (error instanceof BoardError) return own(BOARD_ERRORS, error.code) ?? `Zenit refused the request (${error.code}).`;
  if (error instanceof ClientError) {
    if (error.failure === "protocol") return NEWER_PROTOCOL;
    if (error.failure === "invalid_reply") return INVALID_REPLY;
    const closed = error.failure === "closed" && error.closeCode !== undefined;
    return (closed ? own(CLOSE_MESSAGES, error.closeCode as number) : undefined) ?? NO_ANSWER;
  }
  return "Something went wrong.";
}
