// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { isBadFrameReply, isSeq, validBody } from "../src/protocol/schema";
import { parseStrictObject } from "../src/protocol/strict-json";
import { BOARD_SETTINGS, DEFAULT_SETTINGS, INFO, TIME_STATUS, UPDATE_STATUS, WIFI_STATUS, text } from "./helpers";

const reply = (value: unknown) => parseStrictObject(text(JSON.stringify(value)));
const light = { on: true, effect: "static", color: "white", lightness: 60.0, power_scale: 100, timer: null };

describe("validBody", () => {
  it("accepts the replies of the commands", () => {
    expect(validBody("info", reply({ seq: 1, ok: true, ...INFO }))).toBe(true);
    expect(validBody("status", reply({ seq: 1, ok: true, light }))).toBe(true);
    expect(validBody("light", reply({ seq: 1, ok: true, light: { ...light, on: false, color: null } }))).toBe(true);
    for (const command of ["settings_get", "settings_set", "settings_reset"]) {
      expect(validBody(command, reply({ seq: 1, ok: true, settings: DEFAULT_SETTINGS }))).toBe(true);
    }
  });

  it("accepts a timer, and a lightness written as an integer or with a decimal", () => {
    expect(
      validBody("status", reply({ seq: 1, ok: true, light: { ...light, timer: { minutes: 30, remaining: 100 } } })),
    ).toBe(true);
    expect(validBody("status", reply({ seq: 1, ok: true, light: { ...light, lightness: 0 } }))).toBe(true);
    // JSON.stringify writes 60.0 as 60: the raw text matters for floats
    const raw = text(
      '{"seq":1,"ok":true,"light":{"on":true,"effect":"static","color":null,"lightness":60.0,"power_scale":100,"timer":null}}',
    );
    expect(validBody("status", parseStrictObject(raw))).toBe(true);
  });

  it("ignores fields it does not know", () => {
    expect(validBody("info", reply({ seq: 1, ok: true, ...INFO, wifi: { connected: true }, extra: [1] }))).toBe(true);
  });

  it("accepts any ok reply of a command it has no table for", () => {
    expect(validBody("wifi_forget", reply({ seq: 1, ok: true }))).toBe(true);
  });

  it("refuses a missing or mistyped known field", () => {
    const { firmware: _firmware, ...without } = INFO;
    void _firmware;
    expect(validBody("info", reply({ seq: 1, ok: true, ...without }))).toBe(false);
    expect(validBody("info", reply({ seq: 1, ok: true, ...INFO, firmware: 1 }))).toBe(false);
    expect(validBody("info", reply({ seq: 1, ok: true, ...INFO, colors: ["red", 1] }))).toBe(false);
    expect(validBody("info", reply({ seq: 1, ok: true, ...INFO, memory: { free: 1 } }))).toBe(false);
    expect(validBody("status", reply({ seq: 1, ok: true }))).toBe(false);
    expect(validBody("status", reply({ seq: 1, ok: true, light: { ...light, on: "yes" } }))).toBe(false);
    expect(validBody("status", reply({ seq: 1, ok: true, light: { ...light, timer: { minutes: 1 } } }))).toBe(false);
    expect(
      validBody("settings_get", reply({ seq: 1, ok: true, settings: { ...DEFAULT_SETTINGS, brightness: "60" } })),
    ).toBe(false);
  });

  it("refuses an integer field written as a float", () => {
    const raw = text(
      JSON.stringify({ seq: 1, ok: true, settings: DEFAULT_SETTINGS }).replace('"brightness":60', '"brightness":60.0'),
    );
    expect(validBody("settings_get", parseStrictObject(raw))).toBe(false);
    const power = text(JSON.stringify({ seq: 1, ok: true, light }).replace('"power_scale":100', '"power_scale":1e2'));
    expect(validBody("status", parseStrictObject(power))).toBe(false);
  });

  it("refuses ok that is not exactly true or false", () => {
    expect(validBody("light", reply({ seq: 1, ok: 1, light }))).toBe(false);
    expect(validBody("light", reply({ seq: 1, light }))).toBe(false);
    expect(validBody("light", reply({ seq: 1, ok: "true", light }))).toBe(false);
  });

  it("wants an error code and a message in an error reply", () => {
    expect(validBody("info", reply({ seq: 1, ok: false, error: "busy", message: "wait" }))).toBe(true);
    expect(validBody("info", reply({ seq: 1, ok: false, error: "busy" }))).toBe(false);
    expect(validBody("info", reply({ seq: 1, ok: false, error: 3, message: "x" }))).toBe(false);
  });
});

describe("isSeq", () => {
  it("accepts 0 to 4294967295 as whole numbers", () => {
    expect(isSeq(0)).toBe(true);
    expect(isSeq(4294967295)).toBe(true);
    expect(isSeq(4294967296)).toBe(false);
    expect(isSeq(-1)).toBe(false);
    expect(isSeq(1.5)).toBe(false);
    expect(isSeq("1")).toBe(false);
  });
});

describe("isBadFrameReply", () => {
  it("is an error bad_frame with no seq", () => {
    expect(isBadFrameReply(reply({ ok: false, error: "bad_frame", message: "x" }))).toBe(true);
  });

  it("is not one with a seq, another error, or no message", () => {
    expect(isBadFrameReply(reply({ seq: 1, ok: false, error: "bad_frame", message: "x" }))).toBe(false);
    expect(isBadFrameReply(reply({ ok: false, error: "bad_request", message: "x" }))).toBe(false);
    expect(isBadFrameReply(reply({ ok: false, error: "bad_frame" }))).toBe(false);
    expect(isBadFrameReply(reply({ ok: true }))).toBe(false);
  });
});

describe("the web app part of the update", () => {
  const status = (update: object) => reply({ seq: 1, ok: true, light, update: { ...UPDATE_STATUS, ...update } });
  const web = UPDATE_STATUS.web;

  it("accepts a board without it, and every state the specification has", () => {
    const older: Record<string, unknown> = { ...UPDATE_STATUS };
    delete older["target"];
    delete older["web"];
    expect(validBody("status", reply({ seq: 1, ok: true, light, update: older }))).toBe(true);
    for (const ok of [
      {},
      { state: "downloading", progress: 3, target: "web", web: { ...web, state: "installing", version: null } },
      { web: { ...web, state: "missing", version: null, last_result: "unreachable", retry_in: 61 } },
      { web: { ...web, state: "incompatible", last_result: "incompatible" } },
      { web: { ...web, last_result: "available", available: "1.1.0" } },
      { web: { ...web, state: "repairing", version: null } },
    ]) {
      expect(validBody("status", status(ok)), JSON.stringify(ok)).toBe(true);
    }
  });

  it("refuses what the specification does not allow", () => {
    for (const bad of [
      { target: "both" },
      { target: "web" },
      { web: { ...web, version: null } },
      { web: { ...web, state: "incompatible", version: null } },
      { web: { ...web, state: "missing" } },
      { web: { ...web, state: "installing" } },
      { web: { ...web, retry_in: 30 } },
      { web: { ...web, state: "missing", version: null, retry_in: -1 } },
      { web: { ...web, last_result: "available" } },
      { web: { ...web, last_result: "up_to_date", available: "1.1.0" } },
      { web: { ...web, last_result: "incompatible", available: "2.0.0" } },
      { web: { ...web, available: "1.1" } },
      { web: { ...web, version: "1..2" } },
      { web: { ...web, version: "1." } },
      { web: { ...web, version: "01.2.3" } },
      { web: { ...web, version: "12345.12345.12345" } },
      { web: { state: "ok", version: "1.0.0", available: null, last_result: "never" } },
    ]) {
      expect(validBody("status", status(bad)), JSON.stringify(bad)).toBe(false);
    }
  });

  it("checks the web setting when it is there", () => {
    const settings = (patch: object) => reply({ seq: 1, ok: true, settings: { ...DEFAULT_SETTINGS, ...patch } });
    expect(validBody("settings_get", settings({ update_web: false }))).toBe(true);
    expect(validBody("settings_get", settings({ update_web: "no" }))).toBe(false);
  });
});

describe("the replies of the WiFi and updates milestone", () => {
  it("accepts the status parts, and a status without them", () => {
    expect(validBody("status", reply({ seq: 1, ok: true, light }))).toBe(true);
    expect(
      validBody(
        "status",
        reply({ seq: 1, ok: true, light, wifi: WIFI_STATUS, time: TIME_STATUS, update: UPDATE_STATUS }),
      ),
    ).toBe(true);
    expect(
      validBody(
        "status",
        reply({
          seq: 1,
          ok: true,
          light,
          wifi: { state: "not_configured", ssid: null, rssi: null, ip: null, hostname: "zenit-a1b2" },
          time: { synced: false, epoch: null, local_minute: null },
          update: {
            ...UPDATE_STATUS,
            state: "downloading",
            available: "1.2.0",
            last_check: 5,
            progress: 7,
            skipped: "1.1.0",
            rolled_back: "1.1.0",
          },
        }),
      ),
    ).toBe(true);
  });

  it("accepts the words a newer firmware may add: states, modes, results and the settings that name them", () => {
    for (const ok of [
      { wifi: { ...WIFI_STATUS, state: "roaming", ip: "10.0.0.2", rssi: -50 } },
      // A very strong signal can read slightly above 0 dBm
      { wifi: { ...WIFI_STATUS, rssi: 3 } },
      { wifi: { ...WIFI_STATUS, state: "roaming", ip: null, rssi: null } },
      { update: { ...UPDATE_STATUS, state: "paused" } },
      { update: { ...UPDATE_STATUS, state: "paused", progress: 40 } },
      { update: { ...UPDATE_STATUS, mode: "smart" } },
      { update: { ...UPDATE_STATUS, last_result: "rate_limited" } },
    ])
      expect(validBody("status", reply({ seq: 1, ok: true, light, ...ok })), JSON.stringify(ok)).toBe(true);
    const settings = { ...DEFAULT_SETTINGS, ...BOARD_SETTINGS };
    for (const word of [{ wifi_power: "21" }, { update_mode: "smart" }])
      expect(validBody("settings_get", reply({ seq: 1, ok: true, settings: { ...settings, ...word } }))).toBe(true);
    for (const command of ["update_check", "update_install"])
      expect(
        validBody(command, reply({ seq: 1, ok: true, update: { ...UPDATE_STATUS, last_result: "rate_limited" } })),
      ).toBe(true);
  });

  it("refuses a status part that is there and wrong", () => {
    for (const bad of [
      { wifi: { ...WIFI_STATUS, rssi: "-58" } },
      { wifi: { ...WIFI_STATUS, hostname: null } },
      { wifi: { state: "connected" } },
      { time: { ...TIME_STATUS, synced: 1 } },
      { time: { ...TIME_STATUS, epoch: 1.5 } },
      { update: { ...UPDATE_STATUS, trial: "no" } },
      { update: { ...UPDATE_STATUS, progress: "7" } },
      { update: { ...UPDATE_STATUS, last_result: null } },
      { update: null },
      // Out of range, an unknown word, or a null-when rule broken (docs/board/wifi-and-updates-v1.md#status)
      { wifi: { ...WIFI_STATUS, hostname: "zenit" } },
      { wifi: { ...WIFI_STATUS, rssi: 128 } },
      { wifi: { ...WIFI_STATUS, rssi: -200 } },
      { wifi: { ...WIFI_STATUS, ssid: "" } },
      { wifi: { ...WIFI_STATUS, ssid: "x".repeat(33) } },
      { wifi: { ...WIFI_STATUS, ip: "300.1.1.1" } },
      { wifi: { ...WIFI_STATUS, state: "connected", ip: null } },
      { wifi: { ...WIFI_STATUS, state: "connecting", ip: "192.168.1.5" } },
      { wifi: { ...WIFI_STATUS, state: "wrong_password", rssi: -60, ip: null } },
      { wifi: { ...WIFI_STATUS, state: "not_configured", ip: null, rssi: null, ssid: "HomeNet" } },
      { time: { synced: true, epoch: null, local_minute: null } },
      { time: { synced: false, epoch: 5, local_minute: null } },
      { time: { synced: true, epoch: 5, local_minute: 1440 } },
      { time: { synced: true, epoch: -1, local_minute: 3 } },
      { update: { ...UPDATE_STATUS, state: "downloading", progress: 500 } },
      { update: { ...UPDATE_STATUS, state: "downloading", progress: -1 } },
      { update: { ...UPDATE_STATUS, state: "downloading", progress: null } },
      { update: { ...UPDATE_STATUS, state: "idle", progress: 5 } },
      { update: { ...UPDATE_STATUS, available: "1.2" } },
      { update: { ...UPDATE_STATUS, available: "1.2.0-rc.1" } },
      { update: { ...UPDATE_STATUS, skipped: "latest" } },
      { update: { ...UPDATE_STATUS, rolled_back: 3 } },
      { update: { ...UPDATE_STATUS, last_check: -5 } },
      { update: { ...UPDATE_STATUS, last_result: "available", available: null } },
      { update: { ...UPDATE_STATUS, last_result: "skipped", available: null } },
      { update: { ...UPDATE_STATUS, last_result: "up_to_date", available: "1.2.0" } },
    ])
      expect(validBody("status", reply({ seq: 1, ok: true, light, ...bad })), JSON.stringify(bad)).toBe(false);
  });

  it("accepts settings with the board fields, the token included, and refuses a mistyped one", () => {
    const settings = { ...DEFAULT_SETTINGS, ...BOARD_SETTINGS, token: "abcdefghij012345" };
    for (const command of ["settings_get", "settings_set", "settings_reset"])
      expect(validBody(command, reply({ seq: 1, ok: true, settings }))).toBe(true);
    for (const bad of [
      { wifi_power: 19.5 },
      { update_mode: null },
      { update_firmware: "true" },
      { check_hours: "6" },
      { install_start: 1.5 },
      { network_login: 0 },
      { token: 1 },
      // The ranges and words of the settings table
      { check_hours: 0 },
      { check_hours: 169 },
      { install_start: 1440 },
      { install_end: -1 },
      { time_sync_hours: 0 },
      { time_sync_hours: 169 },
      { timezone: "" },
      { timezone: "A B" },
      { timezone: "x".repeat(65) },
      { ntp_server: "" },
      { ntp_server: "bad host" },
      { ntp_server: "h".repeat(65) },
      { token: "ABCDEFGHIJ012345" },
      { token: "abc" },
    ])
      expect(validBody("settings_get", reply({ seq: 1, ok: true, settings: { ...settings, ...bad } }))).toBe(false);
  });

  it("knows the replies of the new commands", () => {
    expect(validBody("token_regenerate", reply({ seq: 1, ok: true, token: "abcdefghij012345" }))).toBe(true);
    expect(validBody("token_regenerate", reply({ seq: 1, ok: true }))).toBe(false);
    expect(validBody("auth_challenge", reply({ seq: 1, ok: true, nonce: "00".repeat(16) }))).toBe(true);
    for (const nonce of ["00", "0".repeat(31), "0".repeat(33), "G".repeat(32), "A".repeat(32)])
      expect(validBody("auth_challenge", reply({ seq: 1, ok: true, nonce })), nonce).toBe(false);
    for (const token of ["abc", "ABCDEFGHIJ012345", "abcdefghij01234!"])
      expect(validBody("token_regenerate", reply({ seq: 1, ok: true, token })), token).toBe(false);
    expect(validBody("auth_challenge", reply({ seq: 1, ok: true }))).toBe(false);
    for (const command of ["update_check", "update_install"]) {
      expect(validBody(command, reply({ seq: 1, ok: true, update: UPDATE_STATUS }))).toBe(true);
      expect(validBody(command, reply({ seq: 1, ok: true }))).toBe(false);
    }
    for (const command of ["wifi_forget", "auth"]) expect(validBody(command, reply({ seq: 1, ok: true }))).toBe(true);
  });
});

describe("favorites replies", () => {
  const starry = { id: 1, name: "Starry night", effect: "shooting_star", brightness: 60, color: "white" };
  const list = (favorites: unknown[], start: unknown = null) => reply({ seq: 1, ok: true, favorites, start });
  const accepts = (favorites: unknown[], start: unknown = null) =>
    ["favorites", "favorite_save", "favorite_rename", "favorite_delete", "favorite_start"].every((command) =>
      validBody(command, list(favorites, start)),
    );

  it("accepts a list, an empty one and a mark", () => {
    expect(accepts([starry])).toBe(true);
    expect(accepts([])).toBe(true);
    expect(accepts([starry], 1)).toBe(true);
  });

  it("counts a name in characters, not UTF-16 units, and refuses a space at an end", () => {
    expect(accepts([{ ...starry, name: "\u{1f31f}".repeat(20) }])).toBe(true);
    expect(accepts([{ ...starry, name: "\u{1f31f}".repeat(21) }])).toBe(false);
    expect(accepts([{ ...starry, name: " Night" }])).toBe(false);
    expect(accepts([{ ...starry, name: "Night " }])).toBe(false);
    for (const refused of [0x1f, 0x7f, 0x9f, 0x200b, 0x200f, 0x2028, 0x202e, 0x2060, 0x206f, 0xfeff])
      expect(accepts([{ ...starry, name: `a${String.fromCodePoint(refused)}b` }]), refused.toString(16)).toBe(false);
    for (const allowed of [0xa0, 0x2010, 0x2027, 0x202f, 0x205f, 0x2070])
      expect(accepts([{ ...starry, name: `a${String.fromCodePoint(allowed)}b` }]), allowed.toString(16)).toBe(true);
  });

  it("refuses ids and names twice (ASCII letters without case), and a mark that names none", () => {
    expect(accepts([starry, { ...starry, name: "Other" }])).toBe(false);
    expect(accepts([starry, { ...starry, id: 2, name: "STARRY NIGHT" }])).toBe(false);
    expect(
      accepts([
        { ...starry, name: "é" },
        { ...starry, id: 2, name: "É" },
      ]),
    ).toBe(true);
    expect(accepts([starry], 2)).toBe(false);
    expect(accepts([], 1)).toBe(false);
  });

  it("allows six favorites and refuses seven", () => {
    const many = (count: number) => Array.from({ length: count }, (_, i) => ({ ...starry, id: i + 1, name: `N${i}` }));
    expect(accepts(many(6))).toBe(true);
    expect(accepts(many(7))).toBe(false);
  });

  it("checks the id, the brightness and the settings the favorite holds, each optional", () => {
    expect(accepts([{ ...starry, id: 255 }])).toBe(true);
    expect(accepts([{ ...starry, id: 0 }])).toBe(false);
    expect(accepts([{ ...starry, id: 256 }])).toBe(false);
    expect(accepts([{ ...starry, brightness: 0 }])).toBe(false);
    expect(accepts([{ ...starry, hold_seconds: 4 }])).toBe(false);
    expect(accepts([{ ...starry, colors: ["red"] }])).toBe(false);
    expect(accepts([{ ...starry, colors: ["red", "red"] }])).toBe(false);
    expect(accepts([{ ...starry, colors: ["red", "green"], breath_pattern: "box", future: 1 }])).toBe(true);
    const { effect: _effect, ...noEffect } = starry;
    void _effect;
    expect(accepts([noEffect])).toBe(false);
  });

  it("needs the mark to be there, and the array to be one", () => {
    expect(validBody("favorites", reply({ seq: 1, ok: true, favorites: [starry] }))).toBe(false);
    expect(validBody("favorites", reply({ seq: 1, ok: true, favorites: {}, start: null }))).toBe(false);
    expect(validBody("favorites", reply({ seq: 1, ok: true, favorites: [], start: "1" }))).toBe(false);
  });

  it("takes the light and the settings of an apply", () => {
    expect(validBody("favorite_apply", reply({ seq: 1, ok: true, light, settings: DEFAULT_SETTINGS }))).toBe(true);
    expect(validBody("favorite_apply", reply({ seq: 1, ok: true, light }))).toBe(false);
  });

  it("takes the favorites limits together or not at all", () => {
    const limits = (value: unknown) => validBody("info", reply({ seq: 1, ok: true, ...INFO, limits: value }));
    expect(limits({ line: 1024 })).toBe(true);
    expect(limits({ line: 1024, favorites: 6, favorite_name: 20 })).toBe(true);
    expect(limits({ line: 1024, favorites: 6 })).toBe(false);
    expect(limits({ line: 1024, favorite_name: 20 })).toBe(false);
    expect(limits({ line: 1024, favorites: 0, favorite_name: 20 })).toBe(false);
  });
});
