// SPDX-License-Identifier: GPL-3.0-or-later

// The board settings as the app shows and checks them (docs/protocol/protocol-v1.md#settings_get-settings_set). The
// limits equal the protocol's; a change to one changes both.

import type { BoardSettings } from "../protocol/types";

export const BOARD_LIMITS = {
  check_hours: { min: 1, max: 168 },
  time_sync_hours: { min: 1, max: 168 },
  /** Minutes after midnight. */
  minute_of_day: { min: 0, max: 1439 },
  timezone: { min: 1, max: 64 },
  ntp_server: { min: 1, max: 64 },
} as const;

export const WIFI_POWERS = ["auto", "8.5", "11", "13", "15", "17", "18.5", "19.5"] as const;
export const UPDATE_MODES = ["off", "notify", "automatic"] as const;

export const WIFI_POWER_LABELS: Record<string, string> = {
  auto: "Automatic",
  "8.5": "8.5 dBm (lowest)",
  "11": "11 dBm",
  "13": "13 dBm",
  "15": "15 dBm",
  "17": "17 dBm",
  "18.5": "18.5 dBm",
  "19.5": "19.5 dBm (highest)",
};

export const UPDATE_MODE_LABELS: Record<string, string> = {
  off: "Off",
  notify: "Tell me",
  automatic: "Install automatically",
};

export const UPDATE_MODE_HINTS: Record<string, string> = {
  off: "Zenit never looks for new firmware.",
  notify: "Zenit looks for new firmware and tells you. You choose when to install it.",
  automatic: "Zenit installs new firmware by itself, inside the time window below.",
};

/** The time zones offered, as POSIX TZ strings. Anything else is typed in as a custom one. */
export const TIME_ZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "UTC0", label: "UTC (no daylight saving)" },
  { value: "GMT0BST,M3.5.0/1,M10.5.0", label: "London, Dublin" },
  { value: "WET0WEST,M3.5.0/1,M10.5.0", label: "Lisbon" },
  { value: "CET-1CEST,M3.5.0,M10.5.0/3", label: "Rome, Paris, Berlin, Madrid" },
  { value: "EET-2EEST,M3.5.0/3,M10.5.0/4", label: "Athens, Helsinki, Kyiv" },
  { value: "MSK-3", label: "Moscow, Istanbul" },
  { value: "EST5EDT,M3.2.0,M11.1.0", label: "New York, Toronto" },
  { value: "CST6CDT,M3.2.0,M11.1.0", label: "Chicago, Mexico City" },
  { value: "MST7MDT,M3.2.0,M11.1.0", label: "Denver" },
  { value: "PST8PDT,M3.2.0,M11.1.0", label: "Los Angeles, Vancouver" },
  { value: "JST-9", label: "Tokyo, Seoul" },
  { value: "AEST-10AEDT,M10.1.0,M4.1.0/3", label: "Sydney, Melbourne" },
];

/** Why a POSIX TZ string is not acceptable, or null: 1 to 64 printable ASCII characters other than space. */
export function timezoneProblem(text: string): string | null {
  if (!/^[\x21-\x7e]+$/.test(text) || text.length > BOARD_LIMITS.timezone.max) {
    return `Use 1 to ${BOARD_LIMITS.timezone.max} letters, digits or symbols, with no spaces.`;
  }
  return null;
}

/** Why an NTP server is not acceptable, or null: a host name or IPv4 address of 1 to 64 letters, digits, dots and dashes. */
export function ntpServerProblem(text: string): string | null {
  if (!/^[A-Za-z0-9.-]+$/.test(text) || text.length > BOARD_LIMITS.ntp_server.max) {
    return `Use 1 to ${BOARD_LIMITS.ntp_server.max} letters, digits, dots or dashes, for example pool.ntp.org.`;
  }
  return null;
}

/** Why a number of hours is not acceptable, or null. */
export function hoursProblem(text: string, limit: { min: number; max: number }): string | null {
  const value = Number(text);
  if (!/^[0-9]+$/.test(text.trim()) || value < limit.min || value > limit.max) {
    return `Choose a whole number of hours from ${limit.min} to ${limit.max}.`;
  }
  return null;
}

/** "07:30" for minutes after midnight. */
export const formatMinute = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Minutes after midnight for "07:30", or null when the text is not a time of day. */
export function parseMinute(text: string): number | null {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** The install window in words. Equal start and end mean the whole day. */
export function describeWindow(start: number, end: number): string {
  if (start === end) return "Any time of day.";
  return `From ${formatMinute(start)} to ${formatMinute(end)}${end < start ? " (past midnight)" : ""}.`;
}

/** The first setting of the board that is out of its limits, or null. Settings the board does not report are skipped. */
export function boardSettingsProblem(settings: BoardSettings): string | null {
  const inRange = (value: number, limit: { min: number; max: number }): boolean =>
    value >= limit.min && value <= limit.max;
  // `wifi_power` and `update_mode` are words a newer firmware may extend: any text is accepted, the cards name the
  // ones this app knows
  for (const name of ["check_hours", "time_sync_hours"] as const) {
    const value = settings[name];
    if (value !== undefined && !inRange(value, BOARD_LIMITS[name])) return `${name} is out of its limits`;
  }
  for (const name of ["install_start", "install_end"] as const) {
    const value = settings[name];
    if (value !== undefined && !inRange(value, BOARD_LIMITS.minute_of_day)) return `${name} is out of its limits`;
  }
  if (settings.timezone !== undefined && timezoneProblem(settings.timezone) !== null) return "timezone is not valid";
  if (settings.ntp_server !== undefined && ntpServerProblem(settings.ntp_server) !== null)
    return "ntp_server is not valid";
  if (settings.token !== undefined && !/^[a-z0-9]{16}$/.test(settings.token)) return "token is not valid";
  return null;
}

/** The options of a choice among known words, with the board's current word added when this app does not know it, so the
 * choice shows what the board has and a newer firmware's word is never hidden. */
export function choiceOptions(
  values: readonly string[],
  labels: Record<string, string>,
  current: string | undefined,
): Array<{ value: string; label: string }> {
  const options = values.map((value) => ({ value, label: labels[value] ?? value }));
  if (current !== undefined && !values.includes(current))
    options.push({ value: current, label: `${current} (new in this Zenit)` });
  return options;
}
