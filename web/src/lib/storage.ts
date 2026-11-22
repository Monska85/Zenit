// SPDX-License-Identifier: GPL-3.0-or-later

// The two values the app keeps in the browser (docs/web/web-app-v1.md#privacy-rules): the theme and the last address.
// Storage can be missing or refuse to write (a private window), so every access is guarded.

export type ThemeChoice = "system" | "light" | "dark";

const THEME_KEY = "zenit.theme";
const ADDRESS_KEY = "zenit.address";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not kept: the app works without
  }
}

export function loadTheme(): ThemeChoice {
  const value = read(THEME_KEY);
  return value === "light" || value === "dark" ? value : "system";
}

export const saveTheme = (choice: ThemeChoice): void => write(THEME_KEY, choice);
export const loadAddress = (): string => read(ADDRESS_KEY) ?? "";
export const saveAddress = (address: string): void => write(ADDRESS_KEY, address);
