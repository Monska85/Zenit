// SPDX-License-Identifier: GPL-3.0-or-later

// The sentences people read when something goes wrong (docs/web/web-app-v1.md#errors).

import { BoardError, ClientError } from "../protocol/client";

const BOARD_ERRORS: Record<string, string> = {
  bad_request: "Zenit did not accept that value.",
  unknown_command: "This Zenit firmware is too old for that. Update the firmware on the Device page.",
  storage_error: "Zenit could not save that. Nothing was changed.",
  usb_only: "This works only with a USB cable.",
  busy: "Zenit is busy. Try again in a moment.",
};

export const NO_ANSWER = "Zenit did not answer. Check the cable or the address.";

/** The sentence for a failed request. The board's own message is for logs and is never shown. */
export function describeError(error: unknown): string {
  if (error instanceof BoardError) return BOARD_ERRORS[error.code] ?? `Zenit refused the request (${error.code}).`;
  if (error instanceof ClientError) {
    if (error.failure === "protocol")
      return "This Zenit speaks a newer protocol than this app. Reload the app, or update it.";
    return NO_ANSWER;
  }
  return "Something went wrong.";
}
