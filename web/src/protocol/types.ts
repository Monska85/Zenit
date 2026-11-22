// SPDX-License-Identifier: GPL-3.0-or-later

// The replies of the commands as the app uses them, after the schema has accepted them.

import { JsonFloat, type JsonObject, type JsonValue } from "./strict-json";

export interface BoardInfo {
  protocol: number;
  firmware: string;
  board: string;
  boot_id: number;
  colors: string[];
  effects: string[];
  color_sets: string[];
  power_limit_mw: number;
  memory: { free: number; largest: number };
  nvs: { used: number; free: number };
}

/** The light settings of `settings_get`, with the names of the protocol. */
export interface Settings {
  brightness: number;
  effect: string;
  color: string;
  colors: string[];
  color_set: string;
  hold_seconds: number;
  period_seconds: number;
  floor: number;
  twinkle_strength: number;
  timer_minutes: number;
}

export interface LightStatus {
  on: boolean;
  effect: string;
  color: string | null;
  lightness: number;
  power_scale: number;
  timer: { minutes: number; remaining: number } | null;
}

/** A parsed value as plain JavaScript: floats are numbers. */
export const plain = (value: JsonValue): unknown => {
  if (value instanceof JsonFloat) return value.value;
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  }
  return value;
};

/** The object of a reply as plain JavaScript values (floats as numbers), once the schema has checked its types. */
export const toInfo = (reply: JsonObject): BoardInfo => plain(reply) as BoardInfo;
export const toSettings = (reply: JsonObject): Settings => plain(reply["settings"] as JsonValue) as Settings;
export const toLight = (reply: JsonObject): LightStatus => plain(reply["light"] as JsonValue) as LightStatus;
