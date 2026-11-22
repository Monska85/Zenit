// SPDX-License-Identifier: GPL-3.0-or-later

// What a reply must look like (docs/protocol/protocol-v1.md): the same table as `REPLIES` in tools/zenit.py. A reply
// that does not match is unusable and the client asks again. Unknown fields are ignored; every known one has its type.

import { JsonFloat, type JsonObject } from "./strict-json";

export type Check = (value: unknown) => boolean;

/** A whole number written as one (`1`, not `1.0`), within what JavaScript holds exactly. */
export const isInt: Check = (value) => typeof value === "number" && Number.isSafeInteger(value);
export const isNumber: Check = (value) => typeof value === "number" || value instanceof JsonFloat;
export const isText: Check = (value) => typeof value === "string";
export const isBool: Check = (value) => typeof value === "boolean";
export const isNull: Check = (value) => value === null;

export const anyOf =
  (...options: Check[]): Check =>
  (value) =>
    options.some((option) => option(value));

export const arrayOf =
  (item: Check): Check =>
  (value) =>
    Array.isArray(value) && value.every(item);

/** An object with at least these fields, each of its type. */
export const shape =
  (fields: Record<string, Check>): Check =>
  (value) =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof JsonFloat) &&
    Object.entries(fields).every(([key, check]) => Object.hasOwn(value, key) && check((value as JsonObject)[key]));

const SETTINGS = shape({
  brightness: isInt,
  effect: isText,
  color: isText,
  colors: arrayOf(isText),
  color_set: isText,
  hold_seconds: isInt,
  period_seconds: isInt,
  floor: isInt,
  twinkle_strength: isInt,
  timer_minutes: isInt,
});

const LIGHT = shape({
  on: isBool,
  effect: isText,
  color: anyOf(isText, isNull),
  lightness: isNumber,
  power_scale: isInt,
  timer: anyOf(isNull, shape({ minutes: isInt, remaining: isInt })),
});

/** The known fields of a successful reply, by command. */
export const REPLIES: Record<string, Check> = {
  info: shape({
    protocol: isInt,
    firmware: isText,
    board: isText,
    boot_id: isInt,
    colors: arrayOf(isText),
    effects: arrayOf(isText),
    color_sets: arrayOf(isText),
    power_limit_mw: isInt,
    memory: shape({ free: isInt, largest: isInt }),
    nvs: shape({ used: isInt, free: isInt }),
    limits: shape({ line: isInt }),
  }),
  status: shape({ light: LIGHT }),
  light: shape({ light: LIGHT }),
  settings_get: shape({ settings: SETTINGS }),
  settings_set: shape({ settings: SETTINGS }),
  settings_reset: shape({ settings: SETTINGS }),
};

/** Whether a `seq` is one the protocol allows: a whole number from 0 to 4,294,967,295. */
export const isSeq: Check = (value) => isInt(value) && (value as number) >= 0 && (value as number) < 2 ** 32;

/** Whether `ok`, the error fields and the command's known fields of a reply have their types. */
export function validBody(command: string, reply: JsonObject): boolean {
  if (reply["ok"] === false) return isText(reply["error"]) && isText(reply["message"]);
  return reply["ok"] === true && (REPLIES[command] ?? (() => true))(reply);
}

/** The reply to a line the board could not read: no `seq`, an error `bad_frame`. */
export function isBadFrameReply(reply: JsonObject): boolean {
  return (
    !Object.hasOwn(reply, "seq") && validBody("", reply) && reply["ok"] === false && reply["error"] === "bad_frame"
  );
}
