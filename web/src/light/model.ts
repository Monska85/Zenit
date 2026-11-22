// SPDX-License-Identifier: GPL-3.0-or-later

// The light settings as the app shows and checks them (docs/board/light-v1.md, docs/protocol/protocol-v1.md#settings_get-settings_set).
// The limits equal the protocol's; a change to one changes both.

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
export type ParamName =
  "color" | "colors" | "color_set" | "hold_seconds" | "period_seconds" | "floor" | "twinkle_strength";

export interface EffectInfo {
  label: string;
  description: string;
  params: readonly ParamName[];
}

/** What each effect reads is what lib/ZenitLight does: docs/board/light-v1.md#effects. */
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
  return EFFECTS[name] ?? { label: words(name), description: "", params: [] };
}

export const COLOR_LABELS: Record<string, string> = { white: "Warm white", red: "Red", green: "Green", blue: "Blue" };
/** What a color looks like as a swatch on screen. */
export const COLOR_SWATCHES: Record<string, string> = {
  white: "#fff1cf",
  red: "#e5322d",
  green: "#2fa84f",
  blue: "#2f6fe0",
};

export const COLOR_SET_LABELS: Record<string, string> = { christmas: "Christmas", ice: "Ice" };
export const COLOR_SET_COLORS: Record<string, readonly string[]> = {
  christmas: ["red", "green", "white"],
  ice: ["blue", "white"],
};

export const colorLabel = (name: string): string => COLOR_LABELS[name] ?? words(name);
export const colorSetLabel = (name: string): string => COLOR_SET_LABELS[name] ?? words(name);

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
  return null;
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
