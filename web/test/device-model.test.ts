// SPDX-License-Identifier: GPL-3.0-or-later

// The models of the Device view: the limits of docs/protocol/protocol-v1.md, the WiFi rules of
// docs/board/wifi-and-updates-v1.md#limits, and the sentences for the states and results of the board.

import { describe, expect, it } from "vitest";
import {
  BOARD_LIMITS,
  UPDATE_MODES,
  WIFI_POWERS,
  WIFI_POWER_LABELS,
  UPDATE_MODE_LABELS,
  boardSettingsProblem,
  choiceOptions,
  describeWindow,
  formatMinute,
  HOUR_CHOICES,
  hourOptions,
  windowToSend,
  ntpServerProblem,
  parseMinute,
  timezoneProblem,
} from "../src/device/settings";
import {
  boardVerdict,
  canCheck,
  firmwareStateSource,
  firmwareSummary,
  canInstallWeb,
  describeResult,
  describeRetry,
  describeWebResult,
  describeWebState,
  describeUpdateState,
  formatCheckTime,
  installAction,
  updateBusy,
} from "../src/device/update";
import { settingsProblem } from "../src/light/model";
import type { UpdateStatus, WebAppStatus } from "../src/protocol/types";
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

const SETTINGS = toSettings({ settings: { ...DEFAULT_SETTINGS, ...BOARD_SETTINGS } } as unknown as JsonObject);

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

  it("offers no firmware install while the firmware switch is off", () => {
    const found = { available: "1.2.0", last_result: "available" };
    const settings = (update_firmware: boolean) => ({ ...SETTINGS, update_firmware });
    expect(installAction(update(found), WIFI_STATUS, settings(true))).toBe("install");
    expect(installAction(update(found), WIFI_STATUS, settings(false))).toBe("none");
    expect(
      installAction(update({ ...found, last_result: "skipped", skipped: "1.2.0" }), WIFI_STATUS, settings(false)),
    ).toBe("none");
  });

  it("allows a check with the firmware switch off only when the app's updates are on", () => {
    const settings = { ...SETTINGS, update_firmware: false };
    expect(canCheck(update(), WIFI_STATUS, false, settings)).toBe(false);
    expect(canCheck(update(), WIFI_STATUS, true, settings)).toBe(true);
    expect(canCheck(update(), WIFI_STATUS, false, { ...SETTINGS, update_firmware: true })).toBe(true);
  });

  it("names a result or a state that is a member of every object, instead of breaking", () => {
    expect(describeResult("constructor")).toContain("(constructor)");
    expect(describeWebState({ ...UPDATE_STATUS.web, state: "toString" } as WebAppStatus)).toContain("(toString)");
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

describe("the sentences of the app on Zenit", () => {
  const update = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({ ...UPDATE_STATUS, ...patch });
  const web = (patch: Partial<WebAppStatus> = {}): WebAppStatus => ({ ...UPDATE_STATUS.web, ...patch });
  const RESULTS = [
    "never",
    "up_to_date",
    "available",
    "installed",
    "incompatible",
    "no_network",
    "no_time",
    "unreachable",
    "not_published",
    "tls_error",
    "bad_manifest",
    "bad_download",
    "flash_error",
  ];

  it("has a plain sentence for every state and result", () => {
    for (const state of ["ok", "installing", "missing", "incompatible"]) {
      expect(describeWebState(web({ state })), state).toMatch(/\.$/);
      expect(describeWebState(web({ state }))).not.toContain("(");
    }
    const sentences = RESULTS.map((last_result) => describeWebResult(web({ last_result })));
    for (const sentence of sentences) expect(sentence).toMatch(/\.$/);
    expect(new Set(sentences).size).toBe(RESULTS.length);
    expect(describeWebResult(web({ last_result: "available", available: "1.1.0" }))).toBe(
      "Version 1.1.0 of the app is available.",
    );
    expect(describeWebState(web({ state: "odd" }))).toContain("odd");
    expect(describeWebResult(web({ last_result: "odd" }))).toContain("odd");
  });

  it("says when the next try is", () => {
    expect(describeRetry(null)).toBeNull();
    expect(describeRetry(20)).toBe("Zenit tries again in less than a minute.");
    expect(describeRetry(70)).toBe("Zenit tries again in about a minute.");
    expect(describeRetry(1800)).toBe("Zenit tries again in about 30 minutes.");
  });

  it("names what is downloading", () => {
    expect(describeUpdateState(update({ state: "downloading", progress: 5, target: "web" }))).toBe(
      "Downloading the new app: 5 %",
    );
  });

  it("offers to install a new app only when the board can", () => {
    const found = update({ web: web({ last_result: "available", available: "1.1.0" }) });
    expect(canInstallWeb(found, WIFI_STATUS, true)).toBe(true);
    expect(canInstallWeb(found, WIFI_STATUS, false)).toBe(false);
    expect(canInstallWeb(update(), WIFI_STATUS, true)).toBe(false);
    expect(canInstallWeb({ ...found, state: "checking" }, WIFI_STATUS, true)).toBe(false);
    expect(canInstallWeb({ ...found, trial: true }, WIFI_STATUS, true)).toBe(false);
    expect(canInstallWeb(found, { ...WIFI_STATUS, state: "connecting" }, true)).toBe(false);
    const older: UpdateStatus = { ...found };
    delete older.web;
    expect(canInstallWeb(older, WIFI_STATUS, true)).toBe(false);
  });

  it("lets a check run for the app when the firmware's updates are off", () => {
    const off = update({ mode: "off" });
    expect(canCheck(off, WIFI_STATUS)).toBe(false);
    expect(canCheck(off, WIFI_STATUS, true)).toBe(true);
  });
});

describe("hourOptions", () => {
  it("offers every hour, 3, 6, 12 and 24 hours, inside the protocol's limits", () => {
    expect(hourOptions(6)).toEqual([
      { value: "1", label: "Every hour" },
      { value: "3", label: "Every 3 hours" },
      { value: "6", label: "Every 6 hours" },
      { value: "12", label: "Every 12 hours" },
      { value: "24", label: "Every 24 hours" },
    ]);
    for (const hours of HOUR_CHOICES) {
      expect(hours).toBeGreaterThanOrEqual(BOARD_LIMITS.check_hours.min);
      expect(hours).toBeLessThanOrEqual(BOARD_LIMITS.time_sync_hours.max);
    }
  });

  it("keeps a stored value that is not offered, in its place", () => {
    expect(hourOptions(48).map((option) => option.value)).toEqual(["1", "3", "6", "12", "24", "48"]);
    expect(hourOptions(2).map((option) => option.label)).toContain("Every 2 hours");
    expect(hourOptions(2)[1]).toEqual({ value: "2", label: "Every 2 hours" });
    expect(hourOptions(undefined)).toHaveLength(5);
  });
});

describe("windowToSend", () => {
  it("sends both times as minutes after midnight when they change", () => {
    expect(windowToSend("23:00", "02:30", 180, 300)).toEqual({ install_start: 1380, install_end: 150 });
  });

  it("sends nothing when both equal what the board holds", () => {
    expect(windowToSend("03:00", "05:00", 180, 300)).toBeNull();
  });

  it("refuses a time that is empty or not a time of day", () => {
    expect(windowToSend("", "05:00", 180, 300)).toBe("invalid");
    expect(windowToSend("03:00", "24:00", 180, 300)).toBe("invalid");
  });
});

describe("boardVerdict", () => {
  const base: UpdateStatus = {
    mode: "notify",
    state: "idle",
    progress: null,
    last_check: null,
    last_result: "available",
    available: "1.2.0",
    trial: false,
    rolled_back: null,
    skipped: null,
  };

  it("says available or up to date only from a check that found it, with firmware updates on", () => {
    expect(boardVerdict(base, null)).toBe("available");
    expect(boardVerdict({ ...base, last_result: "up_to_date", available: null }, null)).toBe("up_to_date");
    expect(boardVerdict({ ...base, last_result: "skipped", skipped: "1.2.0" }, null)).toBe("skipped");
    expect(boardVerdict({ ...base, last_result: "never", available: null }, null)).toBeNull();
    expect(boardVerdict({ ...base, mode: "off" }, null)).toBeNull();
    expect(boardVerdict(base, { ...DEFAULT_SETTINGS, ...BOARD_SETTINGS, update_firmware: false })).toBeNull();
  });
});

describe("firmwareStateSource", () => {
  const checked: UpdateStatus = {
    mode: "notify",
    state: "idle",
    progress: null,
    last_check: null,
    last_result: "up_to_date",
    available: null,
    trial: false,
    rolled_back: null,
    skipped: null,
  };

  it("takes the board's verdict over the published comparison, and the comparison when the board has none", () => {
    expect(firmwareStateSource(checked, null, "up_to_date")).toEqual({ from: "board", verdict: "up_to_date" });
    expect(firmwareStateSource({ ...checked, last_result: "never" }, null, "update_available")).toEqual({
      from: "published",
      state: "update_available",
    });
    expect(firmwareStateSource(null, null, "newer")).toEqual({ from: "published", state: "newer" });
    expect(firmwareStateSource(null, null, null)).toBeNull();
    // A board that found nothing new before the last release does not hide it
    expect(firmwareStateSource(checked, null, "update_available")).toEqual({
      from: "published",
      state: "update_available",
    });
    // An available update the board names without its version is still the board's
    expect(firmwareStateSource({ ...checked, last_result: "available" }, null, "update_available")).toEqual({
      from: "board",
      verdict: "available",
    });
  });
});

describe("firmwareSummary", () => {
  const update: UpdateStatus = {
    mode: "notify",
    state: "idle",
    progress: null,
    target: null,
    last_check: null,
    last_result: "available",
    available: "1.2.0",
    trial: false,
    rolled_back: null,
    skipped: null,
  };

  it("takes the board's own check first", () => {
    expect(firmwareSummary(update, null, "up_to_date")).toBe("Update available");
    expect(firmwareSummary({ ...update, last_result: "up_to_date", available: null }, null, null)).toBe("Up to date");
    expect(firmwareSummary({ ...update, state: "downloading", target: "firmware" }, null, null)).toBe("Updating");
    expect(firmwareSummary({ ...update, state: "restarting" }, null, null)).toBe("Updating");
    // A check, or a download of the web app, is not the firmware updating
    expect(firmwareSummary({ ...update, state: "checking" }, null, null)).toBe("Update available");
    expect(firmwareSummary({ ...update, state: "downloading", target: "web" }, null, null)).toBe("Update available");
    expect(firmwareSummary({ ...update, last_result: "skipped" }, null, "update_available")).toBe("Update set aside");
  });

  it("falls back to the published firmware when the board's check says nothing either way", () => {
    expect(firmwareSummary({ ...update, mode: "off" }, null, "update_available")).toBe("Update available");
    expect(
      firmwareSummary(update, { ...DEFAULT_SETTINGS, ...BOARD_SETTINGS, update_firmware: false }, null),
    ).toBeNull();
    expect(firmwareSummary({ ...update, last_result: "unreachable" }, null, "newer")).toBe("Newer than published");
    expect(firmwareSummary({ ...update, last_result: "never", available: null }, null, null)).toBeNull();
  });

  it("compares with the published firmware when the board has no check of its own", () => {
    expect(firmwareSummary(null, null, "update_available")).toBe("Update available");
    expect(firmwareSummary(null, null, "up_to_date")).toBe("Up to date");
    expect(firmwareSummary(null, null, "newer")).toBe("Newer than published");
    expect(firmwareSummary(null, null, "unknown")).toBeNull();
    expect(firmwareSummary(null, null, null)).toBeNull();
  });
});
