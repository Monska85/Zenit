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

/**
 * An object with at least these fields, each of its type. The `optional` fields may be missing (a board from before the
 * WiFi and updates milestone leaves them out) but, when present, have their type.
 */
export const shape =
  (fields: Record<string, Check>, optional: Record<string, Check> = {}): Check =>
  (value) =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof JsonFloat) &&
    Object.entries(fields).every(([key, check]) => Object.hasOwn(value, key) && check((value as JsonObject)[key])) &&
    Object.entries(optional).every(([key, check]) => !Object.hasOwn(value, key) || check((value as JsonObject)[key]));

/** A whole number from `low` to `high`. */
const intIn =
  (low: number, high: number): Check =>
  (value) =>
    isInt(value) && (value as number) >= low && (value as number) <= high;
/** A text that matches the pattern entirely. */
const matching =
  (pattern: RegExp): Check =>
  (value) =>
    typeof value === "string" && pattern.test(value);
/** A check that also needs `rule` of the whole object (the null-when and only-when rules of the specification). */
const and =
  (check: Check, rule: (value: JsonObject) => boolean): Check =>
  (value) =>
    check(value) && rule(value as JsonObject);

const RELEASE = matching(/^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/);
const TOKEN = matching(/^[a-z0-9]{16}$/);
/** A network name of 1 to 32 bytes. */
const networkName: Check = (value) =>
  typeof value === "string" && new TextEncoder().encode(value).length <= 32 && value.length >= 1;
/** Four decimal numbers from 0 to 255 without leading zeros. */
const IPV4: Check = (value) =>
  typeof value === "string" &&
  /^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$/.test(value) &&
  value.split(".").every((part) => Number(part) <= 255);

const SETTINGS = shape(
  {
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
  },
  {
    // Words a newer firmware may extend are any text: the app names the ones it knows (docs/protocol/protocol-v1.md#versions)
    wifi_power: isText,
    update_mode: isText,
    update_firmware: isBool,
    check_hours: intIn(1, 168),
    install_start: intIn(0, 1439),
    install_end: intIn(0, 1439),
    timezone: matching(/^[\x21-\x7e]{1,64}$/),
    time_sync_hours: intIn(1, 168),
    ntp_server: matching(/^[A-Za-z0-9.-]{1,64}$/),
    network_login: isBool,
    token: TOKEN,
  },
);

/** The WiFi states of this version that are not connected. */
const WIFI_STATES_WITHOUT_ADDRESS = ["not_configured", "connecting", "not_found", "wrong_password", "no_address"];
/** The update states of this version that are not downloading. */
const UPDATE_STATES_WITHOUT_PROGRESS = ["idle", "checking", "verifying", "restarting"];

const WIFI = and(
  shape({
    state: isText,
    ssid: anyOf(networkName, isNull),
    rssi: anyOf(intIn(-128, 127), isNull),
    ip: anyOf(IPV4, isNull),
    hostname: matching(/^zenit-[0-9a-f]{4}$/),
  }),
  // An address and a signal only while connected; no network stored, no name. A state this app does not know has no rule.
  (wifi) =>
    (wifi["state"] === "connected"
      ? wifi["ip"] !== null
      : !WIFI_STATES_WITHOUT_ADDRESS.includes(wifi["state"] as string) ||
        (wifi["ip"] === null && wifi["rssi"] === null)) &&
    (wifi["state"] !== "not_configured" || wifi["ssid"] === null),
);
// `synced`, the time and the minute of the day come together
const TIME = and(
  shape({
    synced: isBool,
    epoch: anyOf(intIn(0, Number.MAX_SAFE_INTEGER), isNull),
    local_minute: anyOf(intIn(0, 1439), isNull),
  }),
  (time) =>
    (time["synced"] === true) === (time["epoch"] !== null) &&
    (time["synced"] === true) === (time["local_minute"] !== null),
);
const UPDATE = and(
  shape({
    mode: isText,
    state: isText,
    available: anyOf(RELEASE, isNull),
    last_check: anyOf(intIn(0, Number.MAX_SAFE_INTEGER), isNull),
    last_result: isText,
    progress: anyOf(intIn(0, 100), isNull),
    trial: isBool,
    skipped: anyOf(RELEASE, isNull),
    rolled_back: anyOf(RELEASE, isNull),
  }),
  // A percentage only while downloading; a version offered after a check that found one
  (update) =>
    (update["state"] === "downloading"
      ? update["progress"] !== null
      : !UPDATE_STATES_WITHOUT_PROGRESS.includes(update["state"] as string) || update["progress"] === null) &&
    ((update["last_result"] !== "available" && update["last_result"] !== "skipped") || update["available"] !== null) &&
    (update["last_result"] !== "up_to_date" || update["available"] === null),
);

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
  status: shape({ light: LIGHT }, { wifi: WIFI, time: TIME, update: UPDATE }),
  light: shape({ light: LIGHT }),
  settings_get: shape({ settings: SETTINGS }),
  settings_set: shape({ settings: SETTINGS }),
  settings_reset: shape({ settings: SETTINGS }),
  token_regenerate: shape({ token: TOKEN }),
  auth_challenge: shape({ nonce: matching(/^[0-9a-f]{32}$/) }),
  update_check: shape({ update: UPDATE }),
  update_install: shape({ update: UPDATE }),
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
