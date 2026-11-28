// SPDX-License-Identifier: GPL-3.0-or-later

// The light settings as the app shows and checks them (docs/board/light-v1.md, docs/protocol/protocol-v1.md#settings_get-settings_set).
// The limits equal the protocol's; a change to one changes both.

import { own } from "../lib/own";
import { boardSettingsProblem } from "../device/settings";
import { favoriteNameKey, MAX_FAVORITE_NAME, MAX_FAVORITES, REFUSED_IN_NAME } from "../protocol/schema";
import type { BoardInfo, Favorite, Settings } from "../protocol/types";

export type { Settings } from "../protocol/types";

export const LIMITS = {
  brightness: { min: 1, max: 100 },
  hold_seconds: { min: 5, max: 600 },
  period_seconds: { min: 4, max: 20 },
  floor: { min: 5, max: 80 },
  twinkle_strength: { min: 5, max: 50 },
  /** 0 is "no timer"; the custom field takes 1 to this. */
  timer_minutes: { min: 0, max: 360 },
  colors: { min: 2, max: 4 },
} as const;

/** The timer choices offered besides "Off" and a custom number of minutes. */
export const TIMER_PRESETS = [15, 30, 60, 120] as const;

/** The settings an effect reads, in the order the view shows them. */
const PARAM_NAMES = [
  "color",
  "colors",
  "color_set",
  "hold_seconds",
  "period_seconds",
  "breath_pattern",
  "floor",
  "twinkle_strength",
] as const;
export type ParamName = (typeof PARAM_NAMES)[number];
const isParamName = (name: string): name is ParamName => (PARAM_NAMES as readonly string[]).includes(name);

export interface EffectInfo {
  label: string;
  description: string;
  params: readonly ParamName[];
}

/**
 * Labels and descriptions of the effects this app knows. `params` is what each effect reads on a board that does not
 * report `info.effect_settings` (firmware 1.0.0 and earlier), used only for such a board: there Color change and
 * Christmas still read `floor`. A later board reports its own lists (docs/board/light-v1.md#effects).
 */
export const EFFECTS: Record<string, EffectInfo> = {
  static: { label: "Steady", description: "One color, always the same.", params: ["color"] },
  color_change: {
    label: "Color change",
    description: "Slowly moves through the colors you pick.",
    params: ["colors", "hold_seconds", "floor"],
  },
  breathing: {
    label: "Breathing",
    description: "Slowly brightens and dims.",
    params: ["color", "period_seconds", "floor"],
  },
  twinkle: { label: "Twinkle", description: "A gentle shimmer, like a star.", params: ["color", "twinkle_strength"] },
  fall_asleep: {
    label: "Fall asleep",
    description: "Dims slowly while the timer runs.",
    params: ["color", "floor"],
  },
  christmas: {
    label: "Christmas",
    description: "Slowly moves through a palette of colors.",
    params: ["color_set", "hold_seconds", "floor"],
  },
  shooting_star: {
    label: "Shooting star",
    description: "A calm sky with a bright flash now and then.",
    params: ["color"],
  },
  guided_breathing: {
    label: "Guided breathing",
    description: "Breathe along: in as it brightens, out as it dims.",
    params: ["color", "breath_pattern", "floor"],
  },
  jingle: { label: "Jingle", description: "Pulses to the beat of Jingle Bells.", params: ["color_set"] },
  hop: { label: "Hop", description: "Hops from color to color.", params: ["color_set"] },
};

const words = (identifier: string): string => {
  const text = identifier.replace(/_/g, " ").trim();
  return text === "" ? identifier : text.charAt(0).toUpperCase() + text.slice(1);
};

/** An effect the app knows, or a plain description of one it does not: its name in words, no settings. */
export function effectInfo(name: string): EffectInfo {
  return own(EFFECTS, name) ?? { label: words(name), description: "", params: [] };
}

/** The controls of an effect: the settings the app shows, in order, and whether one it cannot show is missing. */
export interface EffectControls {
  params: ParamName[];
  newer: boolean;
}

/**
 * The settings to show for `name`: the list the board reports in `info.effect_settings`, or this app's own table for a
 * board that reports none for it. A setting this app does not know, or an effect it does not know with no list from the
 * board, leaves a control missing: `newer` is then true.
 */
export function effectControls(name: string, info: BoardInfo): EffectControls {
  // The pattern choice needs the patterns the board lists: without them the control cannot show
  const showable = (param: string): param is ParamName =>
    isParamName(param) && (param !== "breath_pattern" || info.breath_patterns !== undefined);
  const reported = info.effect_settings === undefined ? undefined : own(info.effect_settings, name);
  const listed = reported ?? own(EFFECTS, name)?.params;
  if (listed === undefined) return { params: [], newer: true };
  const params = listed.filter(showable);
  return { params, newer: params.length !== listed.length };
}

const COLOR_LABELS: Record<string, string> = { white: "Warm white", red: "Red", green: "Green", blue: "Blue" };
/** What a color looks like as a swatch on screen. */
export const COLOR_SWATCHES: Record<string, string> = {
  white: "#fff1cf",
  red: "#e5322d",
  green: "#2fa84f",
  blue: "#2f6fe0",
};

const COLOR_SET_LABELS: Record<string, string> = {
  christmas: "Christmas",
  ice: "Ice",
  aurora: "Aurora",
  sunset: "Sunset",
  all: "All colors",
};
/** The colors of each palette (docs/board/light-v1.md#palettes). */
export const COLOR_SET_COLORS: Record<string, readonly string[]> = {
  christmas: ["red", "green", "white"],
  ice: ["blue", "white"],
  aurora: ["green", "blue"],
  sunset: ["red", "white"],
  all: ["red", "green", "blue", "white"],
};

/** The patterns of Guided breathing (docs/board/light-v1.md#guided_breathing): a name and its timing in words. */
const BREATH_PATTERNS: Record<string, { label: string; hint: string }> = {
  "4-7-8": { label: "4-7-8", hint: "In 4 s, hold 7 s, out 8 s." },
  box: { label: "Box", hint: "In, hold, out, hold: 4 s each." },
};
export const patternLabel = (name: string): string => own(BREATH_PATTERNS, name)?.label ?? words(name);
export const patternHint = (name: string): string | undefined => own(BREATH_PATTERNS, name)?.hint;

export const colorLabel = (name: string): string => own(COLOR_LABELS, name) ?? words(name);
export const colorSetLabel = (name: string): string => own(COLOR_SET_LABELS, name) ?? words(name);

const inRange = (value: number, limit: { min: number; max: number }): boolean =>
  value >= limit.min && value <= limit.max;

/**
 * Why a settings object cannot be shown, or null when it can: a setting out of its limit, or a color, effect or color
 * set the board does not list in `info`.
 */
export function settingsProblem(settings: Settings, info: BoardInfo): string | null {
  const limits = [
    "brightness",
    "hold_seconds",
    "period_seconds",
    "floor",
    "twinkle_strength",
    "timer_minutes",
  ] as const;
  for (const name of limits) {
    if (!inRange(settings[name], LIMITS[name])) return `${name} is out of its limits`;
  }
  if (!info.effects.includes(settings.effect)) return "the effect is not one the board lists";
  if (!info.colors.includes(settings.color)) return "the color is not one the board lists";
  if (!info.color_sets.includes(settings.color_set)) return "the color set is not one the board lists";
  if (
    settings.breath_pattern !== undefined &&
    info.breath_patterns !== undefined &&
    !info.breath_patterns.includes(settings.breath_pattern)
  )
    return "the breathing pattern is not one the board lists";
  if (!inRange(settings.colors.length, LIMITS.colors)) return "colors is out of its limits";
  if (new Set(settings.colors).size !== settings.colors.length) return "colors names a color twice";
  if (!settings.colors.every((color) => info.colors.includes(color))) return "a color is not one the board lists";
  return boardSettingsProblem(settings);
}

/** "45 s", "12 min", "1 h 12 min": a duration in seconds, rounded down to what a person reads. */
export function formatSeconds(total: number): string {
  const seconds = Math.max(0, Math.floor(total));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

/** A setting of seconds, exactly: "30 s", "2 min", "1 min 30 s". */
export function formatHold(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const rest = seconds % 60;
  return rest === 0 ? `${seconds / 60} min` : `${Math.floor(seconds / 60)} min ${rest} s`;
}

/** "Off", "30 min", "2 h", "1 h 30 min": the timer setting. */
export function formatTimer(minutes: number): string {
  if (minutes === 0) return "Off";
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

/** The time left of a running timer in words that never count seconds: "12 min", "1 h 5 min", "less than a minute". */
export const timeLeft = (seconds: number): string => (seconds < 60 ? "less than a minute" : formatSeconds(seconds));

/** What the light does now in one line: "Warm white · Steady · fades out in 12 min", or "Off". */
export function liveLine(light: {
  on: boolean;
  color: string | null;
  effect: string;
  timer: { remaining: number } | null;
}): {
  color: string;
  effect: string;
  timer: string | null;
} | null {
  if (!light.on) return null;
  return {
    color: light.color === null ? "On" : colorLabel(light.color),
    effect: effectInfo(light.effect).label,
    timer: light.timer !== null && light.timer.remaining > 0 ? `fades out in ${timeLeft(light.timer.remaining)}` : null,
  };
}

/** The label of the timer's Custom choice: with the stored value when it is a custom one. */
export function customTimerLabel(minutes: number): string {
  return minutes !== 0 && !(TIMER_PRESETS as readonly number[]).includes(minutes)
    ? `Custom · ${formatTimer(minutes)}`
    : "Custom";
}

/** The most favorites and the longest name this board accepts, from `info.limits` (the protocol's numbers otherwise). */
export function favoriteLimits(info: BoardInfo): { count: number; name: number } {
  return { count: info.limits.favorites ?? MAX_FAVORITES, name: info.limits.favorite_name ?? MAX_FAVORITE_NAME };
}

/** The names of the settings an effect reads: the board's list, else this app's own, else none (an unknown effect). */
function readSettings(effect: string, info: BoardInfo): readonly string[] {
  const reported = info.effect_settings === undefined ? undefined : own(info.effect_settings, effect);
  return reported ?? own(EFFECTS, effect)?.params ?? [];
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether the light shows `favorite` (ignoring whether it is on): the same effect, the same brightness and the same value
 * of every setting that effect reads. The timer is not part of a look. An effect with no list of settings is compared by
 * effect and brightness only.
 */
export function favoriteMatches(favorite: Favorite, settings: Settings, info: BoardInfo): boolean {
  if (favorite.effect !== settings.effect || favorite.brightness !== settings.brightness) return false;
  const saved = favorite as unknown as Record<string, unknown>;
  const now = settings as unknown as Record<string, unknown>;
  return readSettings(favorite.effect, info).every((name) => {
    const a = own(saved, name);
    const b = own(now, name);
    // A value one side does not have cannot differ
    return a === undefined || b === undefined || sameValue(a, b);
  });
}

const length = (text: string): number => [...text].length;
const cut = (text: string, characters: number): string => [...text].slice(0, characters).join("").trimEnd();

/**
 * The name the save dialog starts with: the effect's name, then "Shooting star 2", "Shooting star 3" and so on while a
 * favorite has it. Always a name the board accepts, within `max` characters.
 */
export function defaultFavoriteName(effectLabel: string, existing: readonly string[], max = MAX_FAVORITE_NAME): string {
  const taken = new Set(existing.map(favoriteNameKey));
  const clean = effectLabel.trim().normalize("NFC");
  const base = clean !== "" && !REFUSED_IN_NAME.test(clean) ? cut(clean, max) : "My light";
  for (let number = 1; ; number++) {
    const suffix = number === 1 ? "" : ` ${number}`;
    const name = `${cut(base, max - suffix.length)}${suffix}`;
    if (!taken.has(favoriteNameKey(name))) return name;
  }
}

/**
 * Checks a name typed by a person. `name` is what to send (normalized, ends trimmed); `problem` is the sentence to show,
 * or null when the board will take it. `exceptId` is the favorite being renamed: it may keep its own name.
 */
export function favoriteNameProblem(
  typed: string,
  favorites: readonly Favorite[],
  exceptId: number | null = null,
  max = MAX_FAVORITE_NAME,
): { name: string; problem: string | null } {
  const name = typed.normalize("NFC").trim();
  const problem = (sentence: string | null): { name: string; problem: string | null } => ({ name, problem: sentence });
  if (name === "") return problem("Give your favorite a name.");
  if (REFUSED_IN_NAME.test(name))
    return problem("That name has a character Zenit cannot keep. Try letters, numbers and spaces.");
  if (length(name) > max) return problem(`Keep the name to ${max} characters or fewer.`);
  const key = favoriteNameKey(name);
  const other = favorites.find((item) => item.id !== exceptId && favoriteNameKey(item.name) === key);
  if (other) return problem(`You already have a favorite called ${other.name}. Choose another name.`);
  return problem(null);
}

/** The color a favorite's preview dot shows: its color, the first of its colors, or the first color of its palette. */
export function favoritePreviewColor(favorite: Favorite): string | null {
  if (favorite.color !== undefined) return favorite.color;
  if (favorite.colors !== undefined && favorite.colors[0] !== undefined) return favorite.colors[0];
  return favorite.color_set === undefined ? null : (own(COLOR_SET_COLORS, favorite.color_set)?.[0] ?? null);
}
