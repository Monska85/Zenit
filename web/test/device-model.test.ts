// SPDX-License-Identifier: GPL-3.0-or-later

// The models of the Device view: the limits of docs/protocol/protocol-v1.md, the WiFi rules of
// docs/board/wifi-and-updates-v1.md#limits, and the sentences for the states and results of the board.

import { describe, expect, it } from "vitest";
import {
  BOARD_LIMITS,
  TIME_ZONES,
  UPDATE_MODES,
  WIFI_POWERS,
  WIFI_POWER_LABELS,
  UPDATE_MODE_LABELS,
  boardSettingsProblem,
  choiceOptions,
  describeWindow,
  formatMinute,
  hoursProblem,
  ntpServerProblem,
  parseMinute,
  timezoneProblem,
} from "../src/device/settings";
import {
  canCheck,
  describeResult,
  describeUpdateState,
  formatCheckTime,
  installAction,
  updateBusy,
} from "../src/device/update";
import { settingsProblem } from "../src/light/model";
import type { UpdateStatus } from "../src/protocol/types";
import {
  WIFI_LIMITS,
  boardAddress,
  describeSignal,
  describeWifiState,
  passwordProblem,
  ssidProblem,
} from "../src/wifi/model";
import { toInfo, toSettings } from "../src/protocol/types";
import type { JsonObject } from "../src/protocol/strict-json";
import { BOARD_SETTINGS, DEFAULT_SETTINGS, INFO, UPDATE_STATUS, WIFI_STATUS } from "./helpers";

describe("the limits of the board settings", () => {
  it("equal the protocol's table", () => {
    expect(BOARD_LIMITS).toEqual({
      check_hours: { min: 1, max: 168 },
      time_sync_hours: { min: 1, max: 168 },
      minute_of_day: { min: 0, max: 1439 },
      timezone: { min: 1, max: 64 },
      ntp_server: { min: 1, max: 64 },
    });
    expect([...WIFI_POWERS]).toEqual(["auto", "8.5", "11", "13", "15", "17", "18.5", "19.5"]);
    expect([...UPDATE_MODES]).toEqual(["off", "notify", "automatic"]);
  });

  it("has a label for every value", () => {
    for (const power of WIFI_POWERS) expect(WIFI_POWER_LABELS[power]).toBeTruthy();
    for (const mode of UPDATE_MODES) expect(UPDATE_MODE_LABELS[mode]).toBeTruthy();
  });

  it("offers time zones the board accepts", () => {
    for (const zone of TIME_ZONES) expect(timezoneProblem(zone.value), zone.value).toBeNull();
    expect(new Set(TIME_ZONES.map((zone) => zone.value)).size).toBe(TIME_ZONES.length);
  });
});

describe("timezoneProblem", () => {
  it("takes 1 to 64 printable ASCII characters other than space", () => {
    expect(timezoneProblem("a")).toBeNull();
    expect(timezoneProblem("a".repeat(64))).toBeNull();
    expect(timezoneProblem("<+03>-3")).toBeNull();
    for (const bad of ["", "a".repeat(65), "CET 1", "CET\t1", "CÉT-1", "a\u007f"])
      expect(timezoneProblem(bad)).not.toBeNull();
  });
});

describe("ntpServerProblem", () => {
  it("takes 1 to 64 letters, digits, dots and dashes", () => {
    for (const good of ["pool.ntp.org", "0.pool-ntp.org", "192.168.1.1", "a", "a".repeat(64)])
      expect(ntpServerProblem(good)).toBeNull();
    for (const bad of ["", "a".repeat(65), "pool ntp.org", "pool_ntp.org", "ntp.org/x", "ntp.org:123"])
      expect(ntpServerProblem(bad)).not.toBeNull();
  });
});

describe("hoursProblem", () => {
  it("takes whole numbers within the limit", () => {
    expect(hoursProblem("1", BOARD_LIMITS.check_hours)).toBeNull();
    expect(hoursProblem("168", BOARD_LIMITS.check_hours)).toBeNull();
    for (const bad of ["0", "169", "", "1.5", "-1", "6h", "1e1"])
      expect(hoursProblem(bad, BOARD_LIMITS.check_hours)).not.toBeNull();
  });
});

describe("times of day", () => {
  it("converts minutes after midnight both ways", () => {
    expect(formatMinute(0)).toBe("00:00");
    expect(formatMinute(1439)).toBe("23:59");
    expect(formatMinute(185)).toBe("03:05");
    expect(parseMinute("03:05")).toBe(185);
    expect(parseMinute("23:59")).toBe(1439);
    for (const bad of ["", "24:00", "3:05", "03:5", "03:60", "03:05:00", "ab:cd"]) expect(parseMinute(bad)).toBeNull();
  });

  it("describes the window, equal times meaning the whole day", () => {
    expect(describeWindow(0, 0)).toBe("Any time of day.");
    expect(describeWindow(600, 600)).toBe("Any time of day.");
    expect(describeWindow(180, 300)).toBe("From 03:00 to 05:00.");
    expect(describeWindow(1380, 120)).toBe("From 23:00 to 02:00 (past midnight).");
  });
});

describe("boardSettingsProblem and settingsProblem", () => {
  const info = toInfo({ ...INFO } as unknown as JsonObject);
  const board = { ...DEFAULT_SETTINGS, ...BOARD_SETTINGS };

  it("accept the defaults, with and without the board fields", () => {
    expect(boardSettingsProblem(BOARD_SETTINGS)).toBeNull();
    expect(boardSettingsProblem({})).toBeNull();
    expect(settingsProblem(toSettings({ settings: board } as unknown as JsonObject), info)).toBeNull();
    expect(settingsProblem(toSettings({ settings: DEFAULT_SETTINGS } as unknown as JsonObject), info)).toBeNull();
  });

  it("accepts a power or an update mode of a newer firmware, and shows it as a choice", () => {
    expect(boardSettingsProblem({ ...BOARD_SETTINGS, wifi_power: "21", update_mode: "smart" })).toBeNull();
    const options = choiceOptions(WIFI_POWERS, WIFI_POWER_LABELS, "21");
    expect(options.at(-1)).toEqual({ value: "21", label: "21 (new in this Zenit)" });
    expect(options).toHaveLength(WIFI_POWERS.length + 1);
    expect(choiceOptions(UPDATE_MODES, UPDATE_MODE_LABELS, "notify")).toHaveLength(UPDATE_MODES.length);
  });

  it.each([
    { check_hours: 0 },
    { check_hours: 169 },
    { time_sync_hours: 0 },
    { install_start: 1440 },
    { install_end: -1 },
    { timezone: "" },
    { timezone: "a b" },
    { ntp_server: "bad host" },
    { token: "ABC" },
  ])("refuse %o", (bad) => {
    expect(boardSettingsProblem({ ...BOARD_SETTINGS, ...bad })).not.toBeNull();
    expect(
      settingsProblem(toSettings({ settings: { ...board, ...bad } } as unknown as JsonObject), info),
    ).not.toBeNull();
  });
});

describe("the WiFi rules", () => {
  it("equal the limits of the specification", () => {
    expect(WIFI_LIMITS).toEqual({
      ssid_bytes: { min: 1, max: 32 },
      password_chars: { min: 8, max: 63 },
      password_hex_digits: 64,
    });
  });

  it("takes a network name of 1 to 32 bytes", () => {
    expect(ssidProblem("a")).toBeNull();
    expect(ssidProblem("a".repeat(32))).toBeNull();
    expect(ssidProblem("é".repeat(16))).toBeNull();
    expect(ssidProblem("😀".repeat(8))).toBeNull();
    expect(ssidProblem("a".repeat(30) + "é")).toBeNull();
    for (const bad of [
      "",
      "a".repeat(33),
      "é".repeat(17),
      "a".repeat(31) + "é",
      "a\0b",
      "a\x01b",
      "a\tb",
      "a\x1fb",
      "a\x7fb",
      "a\ud800b", // a lone surrogate is not UTF-8
    ])
      expect(ssidProblem(bad), JSON.stringify(bad)).not.toBeNull();
  });

  it("takes a password that is empty, 8 to 63 characters, or 64 hexadecimal digits", () => {
    for (const good of [
      "",
      "12345678",
      "a".repeat(63),
      "a".repeat(64),
      "0123456789abcdef".repeat(4),
      "0123456789ABCDEF".repeat(4),
    ])
      expect(passwordProblem(good), good).toBeNull();
    for (const bad of ["1234567", "a".repeat(65), "g".repeat(64) + "0", "abcd\0efgh"])
      expect(passwordProblem(bad)).not.toBeNull();
  });

  it("describes every state of the WiFi", () => {
    for (const state of [
      "not_configured",
      "connecting",
      "connected",
      "not_found",
      "wrong_password",
      "no_address",
      "new",
    ])
      expect(describeWifiState(state, "HomeNet")).toMatch(/\.$/);
    expect(describeWifiState("connected", "HomeNet")).toBe('Connected to "HomeNet".');
    expect(describeWifiState("wrong_password", null)).toContain("the network");
  });

  it("describes the signal and the address", () => {
    expect(describeSignal(-50)).toBe("strong");
    expect(describeSignal(-70)).toBe("fair");
    expect(describeSignal(-90)).toBe("weak");
    expect(boardAddress("zenit-a1b2")).toBe("http://zenit-a1b2.local/");
  });
});

describe("the update sentences", () => {
  const update = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({ ...UPDATE_STATUS, ...patch });
  const RESULTS = [
    "never",
    "up_to_date",
    "available",
    "skipped",
    "installed",
    "no_network",
    "no_time",
    "unreachable",
    "not_published",
    "tls_error",
    "bad_manifest",
    "bad_download",
    "flash_error",
  ];

  it("has a plain sentence for every result of the specification", () => {
    for (const result of RESULTS) {
      const sentence = describeResult(result);
      expect(sentence, result).toMatch(/\.$/);
      expect(sentence).not.toContain(result.replace("_", " ") + "_");
    }
    expect(new Set(RESULTS.map(describeResult)).size).toBe(RESULTS.length);
  });

  it("says plainly that nothing is published yet", () => {
    expect(describeResult("not_published")).toBe(
      "The project site has no firmware published yet, so there is nothing to install.",
    );
  });

  it("names an unknown result instead of hiding it", () => {
    expect(describeResult("new_thing")).toContain("new_thing");
  });

  it("describes what the board is doing", () => {
    expect(describeUpdateState(update())).toBeNull();
    expect(describeUpdateState(update({ state: "checking" }))).toContain("Looking");
    expect(describeUpdateState(update({ state: "downloading", progress: 42 }))).toBe("Downloading the update: 42 %");
    expect(describeUpdateState(update({ state: "downloading", progress: null }))).toBe("Downloading the update...");
    expect(describeUpdateState(update({ state: "verifying" }))).toContain("Checking");
    expect(describeUpdateState(update({ state: "restarting" }))).toContain("Restarting");
    expect(describeUpdateState(update({ state: "strange" }))).toContain("strange");
  });

  it("offers the install button the situation allows", () => {
    const wifi = WIFI_STATUS;
    const found = { available: "1.2.0", last_result: "available" };
    expect(installAction(update(found), wifi)).toBe("install");
    expect(installAction(update({ ...found, last_result: "skipped", skipped: "1.2.0" }), wifi)).toBe("force");
    expect(installAction(update(), wifi)).toBe("none");
    expect(installAction(update({ ...found, state: "downloading" }), wifi)).toBe("none");
    expect(installAction(update({ ...found, mode: "off" }), wifi)).toBe("none");
    expect(installAction(update({ ...found, trial: true }), wifi)).toBe("none");
    expect(installAction(update({ ...found, last_result: "unreachable" }), wifi)).toBe("none");
    expect(installAction(update(found), { ...wifi, state: "connecting" })).toBe("none");
    expect(installAction(update(found), null)).toBe("install");
  });

  it("allows a check only when updates are on, the board is idle and it is connected", () => {
    expect(canCheck(update(), WIFI_STATUS)).toBe(true);
    expect(canCheck(update({ mode: "off" }), WIFI_STATUS)).toBe(false);
    expect(canCheck(update({ state: "checking" }), WIFI_STATUS)).toBe(false);
    expect(canCheck(update(), { ...WIFI_STATUS, state: "not_found" })).toBe(false);
    expect(updateBusy(update({ state: "verifying" }))).toBe(true);
  });

  it("shows the time of the last check in the reader's time zone", () => {
    expect(formatCheckTime(null)).toBeNull();
    const text = formatCheckTime(1_800_000_000, "en-GB");
    expect(text).toMatch(/2027/);
    expect(new Date(1_800_000_000 * 1000).getUTCFullYear()).toBe(2027);
  });
});
