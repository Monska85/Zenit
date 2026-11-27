// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
  COLOR_SET_COLORS,
  COLOR_SWATCHES,
  EFFECTS,
  LIMITS,
  effectControls,
  effectInfo,
  formatHold,
  formatSeconds,
  formatTimer,
  settingsProblem,
} from "../src/light/model";
import { toInfo, toSettings } from "../src/protocol/types";
import type { JsonObject } from "../src/protocol/strict-json";
import { DEFAULT_SETTINGS, INFO } from "./helpers";

const info = toInfo(INFO as unknown as JsonObject);
const settings = (patch: Record<string, unknown> = {}) =>
  toSettings({ settings: { ...DEFAULT_SETTINGS, ...patch } } as unknown as JsonObject);

describe("limits", () => {
  it("equal the protocol's", () => {
    expect(LIMITS).toEqual({
      brightness: { min: 1, max: 100 },
      hold_seconds: { min: 5, max: 600 },
      period_seconds: { min: 4, max: 20 },
      floor: { min: 5, max: 80 },
      twinkle_strength: { min: 5, max: 50 },
      timer_minutes: { min: 0, max: 360 },
      colors: { min: 2, max: 4 },
    });
  });

  it("sits where docs/protocol/protocol-v1.md puts them", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const spec = readFileSync(join(import.meta.dirname, "..", "..", "docs", "protocol", "protocol-v1.md"), "utf8");
    expect(spec).toMatch(/\| `brightness`\s+\| integer \| `60`\s+\| 1 to 100\./);
    expect(spec).toMatch(/\| `hold_seconds`\s+\| integer \| `30`\s+\| 5 to 600\./);
    expect(spec).toMatch(/\| `period_seconds`\s+\| integer \| `8`\s+\| 4 to 20\./);
    expect(spec).toMatch(/\| `floor`\s+\| integer \| `20`\s+\| 5 to 80\./);
    expect(spec).toMatch(/\| `twinkle_strength`\s+\| integer \| `20`\s+\| 5 to 50\./);
    expect(spec).toMatch(/\| `timer_minutes`\s+\| integer \| `0`\s+\| 0 \(no timer\), or 1 to 360\./);
  });
});

describe("effects", () => {
  it("show only the settings each effect reads (docs/board/light-v1.md#effects)", () => {
    expect(EFFECTS["static"]?.params).toEqual(["color"]);
    expect(EFFECTS["color_change"]?.params).toEqual(["colors", "hold_seconds", "floor"]);
    expect(EFFECTS["breathing"]?.params).toEqual(["color", "period_seconds", "floor"]);
    expect(EFFECTS["twinkle"]?.params).toEqual(["color", "twinkle_strength"]);
    expect(EFFECTS["fall_asleep"]?.params).toEqual(["color", "floor"]);
    expect(EFFECTS["christmas"]?.params).toEqual(["color_set", "hold_seconds", "floor"]);
  });

  it("match the effect table of the light specification", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const spec = readFileSync(join(import.meta.dirname, "..", "..", "docs", "board", "light-v1.md"), "utf8");
    for (const [name, effect] of Object.entries(EFFECTS)) {
      const row = new RegExp("\\| `" + name + "`\\s+\\| ([^|]+)\\|").exec(spec);
      expect(row, name).not.toBeNull();
      const documented = [...(row?.[1] ?? "").matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
      expect(documented, name).toEqual(effect.params);
    }
  });

  it("are the ones the board reports in the info conformance case", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(import.meta.dirname, "..", "..");
    const spec = readFileSync(join(root, "docs", "board", "light-v1.md"), "utf8");
    const exchange = JSON.parse(readFileSync(join(root, "conformance", "protocol", "command_info.json"), "utf8")) as {
      steps: { expect: { effects: string[]; effect_settings: Record<string, string[]> } }[];
    };
    const reply = exchange.steps[0]!.expect;
    expect(Object.keys(reply.effect_settings)).toEqual(reply.effects);
    for (const name of reply.effects) {
      const row = new RegExp("\\| `" + name + "`\\s+\\| ([^|]+)\\|").exec(spec);
      const documented = [...(row?.[1] ?? "").matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
      expect(reply.effect_settings[name], name).toEqual(documented);
    }
  });

  it("show the settings the board names, in its order", () => {
    const named = { ...info, effect_settings: { breathing: ["floor", "color"], northern_lights: ["color"] } };
    expect(effectControls("breathing", named)).toEqual({ params: ["floor", "color"], newer: false });
    // An effect the app does not know, with settings it knows: nothing is missing
    expect(effectControls("northern_lights", named)).toEqual({ params: ["color"], newer: false });
    expect(effectControls("static", { ...info, effect_settings: { static: [] } })).toEqual({
      params: [],
      newer: false,
    });
  });

  it("say a setting is missing when the board names one the app does not know", () => {
    const named = { ...info, effect_settings: { twinkle: ["color", "sparkle", "twinkle_strength"] } };
    expect(effectControls("twinkle", named)).toEqual({ params: ["color", "twinkle_strength"], newer: true });
    expect(effectControls("static", { ...info, effect_settings: { static: ["constructor"] } })).toEqual({
      params: [],
      newer: true,
    });
  });

  it("fall back to the app's table for a board that names none for the effect", () => {
    const older = { ...info };
    delete older.effect_settings;
    expect(effectControls("color_change", older)).toEqual({
      params: ["colors", "hold_seconds", "floor"],
      newer: false,
    });
    expect(effectControls("christmas", { ...info, effect_settings: {} })).toEqual({
      params: ["color_set", "hold_seconds", "floor"],
      newer: false,
    });
    expect(effectControls("constructor", { ...info, effect_settings: {} })).toEqual({ params: [], newer: true });
    expect(effectControls("northern_lights", older)).toEqual({ params: [], newer: true });
  });

  it("have a swatch and a name for every color, and the color sets of the specification", () => {
    for (const color of INFO.colors) expect(COLOR_SWATCHES[color]).toMatch(/^#[0-9a-f]{6}$/);
    expect(COLOR_SET_COLORS).toEqual({ christmas: ["red", "green", "white"], ice: ["blue", "white"] });
  });

  it("describe an effect the app does not know in words, with no settings", () => {
    expect(effectInfo("northern_lights")).toEqual({ label: "Northern lights", description: "", params: [] });
    expect(effectInfo("static").label).toBe("Steady");
  });
});

describe("settingsProblem", () => {
  it("accepts the defaults and the extremes", () => {
    expect(settingsProblem(settings(), info)).toBeNull();
    expect(
      settingsProblem(
        settings({
          brightness: 1,
          hold_seconds: 600,
          period_seconds: 4,
          floor: 80,
          twinkle_strength: 50,
          timer_minutes: 360,
        }),
        info,
      ),
    ).toBeNull();
    expect(
      settingsProblem(
        settings({ brightness: 100, hold_seconds: 5, period_seconds: 20, floor: 5, twinkle_strength: 5 }),
        info,
      ),
    ).toBeNull();
  });

  it.each([
    ["brightness", 0],
    ["brightness", 101],
    ["hold_seconds", 4],
    ["hold_seconds", 601],
    ["period_seconds", 3],
    ["period_seconds", 21],
    ["floor", 4],
    ["floor", 81],
    ["twinkle_strength", 4],
    ["twinkle_strength", 51],
    ["timer_minutes", -1],
    ["timer_minutes", 361],
  ])("refuses %s of %i", (name, value) => {
    expect(settingsProblem(settings({ [name]: value }), info)).toContain(name);
  });

  it("refuses what the board does not list, and bad color lists", () => {
    expect(settingsProblem(settings({ effect: "disco" }), info)).not.toBeNull();
    expect(settingsProblem(settings({ color: "pink" }), info)).not.toBeNull();
    expect(settingsProblem(settings({ color_set: "neon" }), info)).not.toBeNull();
    expect(settingsProblem(settings({ colors: ["red"] }), info)).not.toBeNull();
    expect(settingsProblem(settings({ colors: ["red", "red"] }), info)).not.toBeNull();
    expect(settingsProblem(settings({ colors: ["red", "pink"] }), info)).not.toBeNull();
    expect(settingsProblem(settings({ colors: ["red", "green", "blue", "white", "red"] }), info)).not.toBeNull();
  });
});

describe("formats", () => {
  it.each([
    [0, "0 s"],
    [45, "45 s"],
    [59.9, "59 s"],
    [60, "1 min"],
    [754, "12 min"],
    [3600, "1 h"],
    [4320, "1 h 12 min"],
    [-5, "0 s"],
  ])("formatSeconds(%d) is %s", (value, text) => expect(formatSeconds(value)).toBe(text));

  it.each([
    [5, "5 s"],
    [30, "30 s"],
    [60, "1 min"],
    [90, "1 min 30 s"],
    [600, "10 min"],
  ])("formatHold(%d) is %s", (value, text) => expect(formatHold(value)).toBe(text));

  it.each([
    [0, "Off"],
    [1, "1 min"],
    [15, "15 min"],
    [60, "1 h"],
    [90, "1 h 30 min"],
    [120, "2 h"],
    [360, "6 h"],
  ])("formatTimer(%d) is %s", (value, text) => expect(formatTimer(value)).toBe(text));
});
