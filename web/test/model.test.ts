// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
  COLOR_SET_COLORS,
  COLOR_SWATCHES,
  EFFECTS,
  LIMITS,
  effectControls,
  defaultFavoriteName,
  effectInfo,
  favoriteLimits,
  favoriteMatches,
  favoriteNameProblem,
  favoritePreviewColor,
  formatHold,
  formatSeconds,
  formatTimer,
  colorSetLabel,
  patternHint,
  patternLabel,
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
    // The pattern is a word the board lists, with the default of both documents
    expect(spec).toMatch(/\| `breath_pattern`\s+\| string\s+\| `4-7-8`\s+\| One of `info.breath_patterns`\./);
    const light = readFileSync(join(import.meta.dirname, "..", "..", "docs", "board", "light-v1.md"), "utf8");
    expect(light).toMatch(/\| `breath_pattern`\s+\| `4-7-8` or `box`\s+\|/);
    expect(light).toMatch(/\| `guided_breathing` \| `color`, `breath_pattern`, `floor`\s+\| `white`, `4-7-8`, 20\s+\|/);
  });
});

describe("effects", () => {
  it("show only the settings each effect reads (docs/board/light-v1.md#effects)", () => {
    expect(EFFECTS["static"]?.params).toEqual(["color"]);
    // The list of a board without info.effect_settings (firmware 1.0.0 and earlier), where they still read floor
    expect(EFFECTS["color_change"]?.params).toEqual(["colors", "hold_seconds", "floor"]);
    expect(EFFECTS["breathing"]?.params).toEqual(["color", "period_seconds", "floor"]);
    expect(EFFECTS["twinkle"]?.params).toEqual(["color", "twinkle_strength"]);
    expect(EFFECTS["fall_asleep"]?.params).toEqual(["color", "floor"]);
    expect(EFFECTS["christmas"]?.params).toEqual(["color_set", "hold_seconds", "floor"]);
    expect(EFFECTS["shooting_star"]?.params).toEqual(["color"]);
    expect(EFFECTS["guided_breathing"]?.params).toEqual(["color", "breath_pattern", "floor"]);
    expect(EFFECTS["jingle"]?.params).toEqual(["color_set"]);
    expect(EFFECTS["hop"]?.params).toEqual(["color_set"]);
  });

  it("match the effect table of the light specification", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const spec = readFileSync(join(import.meta.dirname, "..", "..", "docs", "board", "light-v1.md"), "utf8");
    for (const [name, effect] of Object.entries(EFFECTS)) {
      const row = new RegExp("\\| `" + name + "`\\s+\\| ([^|]+)\\|").exec(spec);
      expect(row, name).not.toBeNull();
      const documented = [...(row?.[1] ?? "").matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
      // Color change and Christmas stopped reading floor when the board started reporting its lists; the app's list
      // is for the boards before that, which still read it
      const before = name === "color_change" || name === "christmas" ? [...documented, "floor"] : documented;
      expect(before, name).toEqual(effect.params);
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
    expect(COLOR_SET_COLORS).toEqual({
      christmas: ["red", "green", "white"],
      ice: ["blue", "white"],
      aurora: ["green", "blue"],
      sunset: ["red", "white"],
      all: ["red", "green", "blue", "white"],
    });
    expect(INFO.color_sets.map(colorSetLabel)).toEqual(["Christmas", "Ice", "Aurora", "Sunset", "All colors"]);
  });

  it("have the palettes of the light specification", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const spec = readFileSync(join(import.meta.dirname, "..", "..", "docs", "board", "light-v1.md"), "utf8");
    const table = spec.slice(spec.indexOf("### Palettes"), spec.indexOf("### At most 3 light changes"));
    for (const [name, colors] of Object.entries(COLOR_SET_COLORS)) {
      const row = new RegExp("\\| `" + name + "`\\s+\\| ([^|]+)\\|").exec(table);
      expect(row, name).not.toBeNull();
      expect(
        [...(row?.[1] ?? "").matchAll(/`([a-z]+)`/g)].map((match) => match[1]),
        name,
      ).toEqual(colors);
    }
  });

  it("show the pattern choice only when the board lists the patterns", () => {
    expect(effectControls("guided_breathing", info)).toEqual({
      params: ["color", "breath_pattern", "floor"],
      newer: false,
    });
    const unlisted = { ...info };
    delete unlisted.breath_patterns;
    expect(effectControls("guided_breathing", unlisted)).toEqual({ params: ["color", "floor"], newer: true });
    expect(patternLabel("box")).toBe("Box");
    expect(patternLabel("4-7-8")).toBe("4-7-8");
    expect(patternLabel("slow_wave")).toBe("Slow wave");
    expect(patternHint("4-7-8")).toBe("In 4 s, hold 7 s, out 8 s.");
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
    expect(settingsProblem(settings({ breath_pattern: "triangle" }), info)).toContain("breathing pattern");
    expect(settingsProblem(settings({ breath_pattern: "box", color_set: "all" }), info)).toBeNull();
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

describe("favoriteMatches", () => {
  const christmas = {
    id: 2,
    name: "Christmas",
    effect: "christmas",
    brightness: 60,
    color_set: "christmas",
    hold_seconds: 30,
  };

  it("matches the effect, the brightness and every setting the effect reads", () => {
    const now = settings({ effect: "christmas", color_set: "christmas", hold_seconds: 30 });
    expect(favoriteMatches(christmas, now, info)).toBe(true);
    expect(favoriteMatches(christmas, settings({ ...now, brightness: 61 }), info)).toBe(false);
    expect(favoriteMatches(christmas, settings({ ...now, effect: "hop" }), info)).toBe(false);
    expect(favoriteMatches(christmas, settings({ ...now, hold_seconds: 31 }), info)).toBe(false);
    expect(favoriteMatches(christmas, settings({ ...now, color_set: "ice" }), info)).toBe(false);
  });

  it("ignores the settings the effect does not read and the timer", () => {
    const now = settings({ effect: "christmas", color: "red", floor: 70, timer_minutes: 30 });
    expect(favoriteMatches(christmas, now, info)).toBe(true);
  });

  it("compares the colors in order", () => {
    const saved = {
      id: 3,
      name: "Rainbow",
      effect: "color_change",
      brightness: 60,
      colors: ["red", "green"],
      hold_seconds: 30,
    };
    const now = settings({ effect: "color_change", colors: ["red", "green"] });
    expect(favoriteMatches(saved, now, info)).toBe(true);
    expect(favoriteMatches(saved, settings({ ...now, colors: ["green", "red"] }), info)).toBe(false);
  });

  it("uses the list the board reports, else the app's own", () => {
    const own = {
      id: 4,
      name: "Breath",
      effect: "breathing",
      brightness: 60,
      color: "white",
      period_seconds: 8,
      floor: 20,
    };
    const now = settings({ effect: "breathing", floor: 21 });
    expect(favoriteMatches(own, now, info)).toBe(false);
    // The board says Breathing reads no floor: it does not count
    const narrow = toInfo({
      ...INFO,
      effect_settings: { ...INFO.effect_settings, breathing: ["color", "period_seconds"] },
    } as unknown as JsonObject);
    expect(favoriteMatches(own, now, narrow)).toBe(true);
    // A board with no lists: the app's table, where Breathing reads the floor
    const { effect_settings: _lists, ...without } = INFO;
    void _lists;
    const old = toInfo(without as unknown as JsonObject);
    expect(favoriteMatches(own, now, old)).toBe(false);
  });

  it("compares an effect nobody lists by effect and brightness only", () => {
    const newer = { id: 5, name: "Aurora", effect: "northern_lights", brightness: 60, color: "red" };
    expect(favoriteMatches(newer, settings({ effect: "northern_lights", color: "blue" }), info)).toBe(true);
    expect(favoriteMatches(newer, settings({ effect: "northern_lights", brightness: 50 }), info)).toBe(false);
  });
});

const ZERO_WIDTH = String.fromCodePoint(0x200b);

describe("defaultFavoriteName", () => {
  it("is the effect's name, then the name with 2, 3 and so on", () => {
    expect(defaultFavoriteName("Shooting star", [])).toBe("Shooting star");
    expect(defaultFavoriteName("Shooting star", ["Shooting star"])).toBe("Shooting star 2");
    expect(defaultFavoriteName("Shooting star", ["Shooting star", "Shooting star 2"])).toBe("Shooting star 3");
    expect(defaultFavoriteName("Shooting star", ["shooting STAR"])).toBe("Shooting star 2");
  });

  it("never goes over 20 characters, and the name stays a name the board takes", () => {
    const long = "A".repeat(20);
    expect(defaultFavoriteName(long, [])).toBe(long);
    expect(defaultFavoriteName(long, [long])).toBe(`${"A".repeat(18)} 2`);
    expect(defaultFavoriteName("Guided breathing now", ["Guided breathing now"])).toBe("Guided breathing n 2");
    expect(defaultFavoriteName("B".repeat(30), [])).toBe("B".repeat(20));
    const names = [long];
    for (let number = 2; number <= 12; number++) names.push(defaultFavoriteName(long, names));
    expect(names.every((name) => [...name].length <= 20)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    expect(defaultFavoriteName("", [])).toBe("My light");
    expect(defaultFavoriteName(`a${ZERO_WIDTH}b`, [])).toBe("My light");
  });
});

describe("favoriteNameProblem", () => {
  const list = [
    { id: 1, name: "Starry night", effect: "static", brightness: 60 },
    { id: 2, name: "Christmas", effect: "static", brightness: 60 },
  ];
  const check = (name: string, exceptId: number | null = null) => favoriteNameProblem(name, list, exceptId);

  it("takes a name, trims its ends and writes it in NFC", () => {
    expect(check("  Bedtime  ")).toEqual({ name: "Bedtime", problem: null });
    expect(check("Café")).toEqual({ name: "Café", problem: null });
    expect(check("Bath \u{1f6c1} time").problem).toBeNull();
  });

  it("says what is wrong, in the sentences of the design", () => {
    expect(check("").problem).toBe("Give your favorite a name.");
    expect(check("   ").problem).toBe("Give your favorite a name.");
    expect(check("x".repeat(21)).problem).toBe("Keep the name to 20 characters or fewer.");
    expect(check("a\tb").problem).toBe("That name has a character Zenit cannot keep. Try letters, numbers and spaces.");
    expect(check(`a${ZERO_WIDTH}b`).problem).toBe(
      "That name has a character Zenit cannot keep. Try letters, numbers and spaces.",
    );
    expect(check("christmas").problem).toBe("You already have a favorite called Christmas. Choose another name.");
  });

  it("counts characters, not UTF-16 units", () => {
    expect(check("\u{1f31f}".repeat(20)).problem).toBeNull();
    expect(check("\u{1f31f}".repeat(21)).problem).toBe("Keep the name to 20 characters or fewer.");
  });

  it("compares only ASCII letters without case, and lets a favorite keep its own name", () => {
    expect(favoriteNameProblem("École", [{ ...list[0]!, name: "école" }]).problem).toBeNull();
    expect(check("STARRY NIGHT", 1).problem).toBeNull();
    expect(check("STARRY NIGHT", 2).problem).toContain("Starry night");
  });
});

describe("favoritePreviewColor", () => {
  it("is the color, the first of the colors, or the first color of the palette", () => {
    const base = { id: 1, name: "A", effect: "static", brightness: 60 };
    expect(favoritePreviewColor({ ...base, color: "blue" })).toBe("blue");
    expect(favoritePreviewColor({ ...base, colors: ["green", "red"] })).toBe("green");
    expect(favoritePreviewColor({ ...base, color_set: "ice" })).toBe("blue");
    expect(favoritePreviewColor({ ...base, color_set: "christmas" })).toBe("red");
    expect(favoritePreviewColor(base)).toBeNull();
    expect(favoritePreviewColor({ ...base, color_set: "newer" })).toBeNull();
  });
});

describe("favoriteLimits", () => {
  it("are the board's, else the protocol's", () => {
    expect(favoriteLimits(info)).toEqual({ count: 6, name: 20 });
    expect(favoriteLimits({ ...info, limits: { line: 1024, favorites: 4, favorite_name: 12 } })).toEqual({
      count: 4,
      name: 12,
    });
  });
});
