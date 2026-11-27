// SPDX-License-Identifier: GPL-3.0-or-later

// The light settings as the app shows and checks them (docs/board/light-v1.md, docs/protocol/protocol-v1.md#settings_get-settings_set).
// The limits equal the protocol's; a change to one changes both.

import { own } from "../lib/own";
import { boardSettingsProblem } from "../device/settings";
import type { BoardInfo, Settings } from "../protocol/types";

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
 * Labels and descriptions of the effects this app knows. `params` is what each effect reads in lib/ZenitLight
 * (docs/board/light-v1.md#effects), used only for a board that does not report `info.effect_settings`.
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
    description: "Red, green and white, or icy blue.",
    params: ["color_set", "hold_seconds", "floor"],
  },
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
  const reported = info.effect_settings === undefined ? undefined : own(info.effect_settings, name);
  if (reported !== undefined) {
    const params = reported.filter(isParamName);
    return { params, newer: params.length !== reported.length };
  }
  const known = own(EFFECTS, name);
  return known === undefined ? { params: [], newer: true } : { params: [...known.params], newer: false };
}

const COLOR_LABELS: Record<string, string> = { white: "Warm white", red: "Red", green: "Green", blue: "Blue" };
/** What a color looks like as a swatch on screen. */
export const COLOR_SWATCHES: Record<string, string> = {
  white: "#fff1cf",
  red: "#e5322d",
  green: "#2fa84f",
  blue: "#2f6fe0",
};

const COLOR_SET_LABELS: Record<string, string> = { christmas: "Christmas", ice: "Ice" };
export const COLOR_SET_COLORS: Record<string, readonly string[]> = {
  christmas: ["red", "green", "white"],
  ice: ["blue", "white"],
};

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
