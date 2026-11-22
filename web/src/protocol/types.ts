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
export interface Settings extends BoardSettings {
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

/** The board settings, from the WiFi and updates milestone: all optional, a firmware from before it has none. */
export interface BoardSettings {
  wifi_power?: string;
  update_mode?: string;
  update_firmware?: boolean;
  check_hours?: number;
  install_start?: number;
  install_end?: number;
  timezone?: string;
  time_sync_hours?: number;
  ntp_server?: string;
  network_login?: boolean;
  /** Only in `settings_get` over USB. */
  token?: string;
}

export interface LightStatus {
  on: boolean;
  effect: string;
  color: string | null;
  lightness: number;
  power_scale: number;
  timer: { minutes: number; remaining: number } | null;
}

export interface WifiStatus {
  state: string;
  ssid: string | null;
  rssi: number | null;
  ip: string | null;
  hostname: string;
}

export interface TimeStatus {
  synced: boolean;
  epoch: number | null;
  local_minute: number | null;
}

export interface UpdateStatus {
  mode: string;
  state: string;
  available: string | null;
  last_check: number | null;
  last_result: string;
  progress: number | null;
  trial: boolean;
  skipped: string | null;
  rolled_back: string | null;
}

/** What `status` reports: the light, and from the WiFi and updates milestone the rest (null from an older board). */
export interface BoardStatus {
  light: LightStatus;
  wifi: WifiStatus | null;
  time: TimeStatus | null;
  update: UpdateStatus | null;
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
export const toStatus = (reply: JsonObject): BoardStatus => {
  const value = plain(reply) as Partial<BoardStatus>;
  return {
    light: value.light as LightStatus,
    wifi: value.wifi ?? null,
    time: value.time ?? null,
    update: value.update ?? null,
  };
};
/** The `update` object of `update_check` and `update_install`. */
export const toUpdate = (reply: JsonObject): UpdateStatus => plain(reply["update"] as JsonValue) as UpdateStatus;
