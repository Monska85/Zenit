// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { isBadFrameReply, isSeq, validBody } from "../src/protocol/schema";
import { parseStrictObject } from "../src/protocol/strict-json";
import { DEFAULT_SETTINGS, INFO, text } from "./helpers";

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
