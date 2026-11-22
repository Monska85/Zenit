// SPDX-License-Identifier: GPL-3.0-or-later

import { loadTheme, saveTheme, type ThemeChoice } from "./storage";

const query = (): MediaQueryList => window.matchMedia("(prefers-color-scheme: dark)");

/** Puts the theme on the page: the choice, or the system's when it is "system". */
export function applyTheme(choice: ThemeChoice): void {
  const dark = choice === "dark" || (choice === "system" && query().matches);
  document.documentElement.dataset["theme"] = dark ? "dark" : "light";
}

export function currentTheme(): ThemeChoice {
  return loadTheme();
}

export function chooseTheme(choice: ThemeChoice): void {
  saveTheme(choice);
  applyTheme(choice);
}

/** Applies the saved theme and follows the system while the choice is "system". */
export function startTheme(): void {
  applyTheme(loadTheme());
  query().addEventListener("change", () => applyTheme(loadTheme()));
}

export const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
