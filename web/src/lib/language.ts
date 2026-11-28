// SPDX-License-Identifier: GPL-3.0-or-later

// The language of the page (docs/web/web-app-v1.md#languages): the person's choice, kept in the browser, or the
// browser's own languages while the choice is "Match my device". The choice never leaves the browser.

import { changeLanguage, i18n, resolveLanguage } from "../i18n";
import { loadLanguage, saveLanguage } from "./storage";

const browserLanguages = (): readonly string[] => navigator.languages ?? [navigator.language];

/** The last change of language asked for; each waits for the one before, so the last choice is the one that stays. */
let changes: Promise<void> = Promise.resolve();

/**
 * Switches to the language the choice gives, loading its catalogs first. A catalog that fails to load leaves English.
 */
function apply(choice: string | null): Promise<void> {
  changes = changes.then(async () => {
    try {
      await changeLanguage(resolveLanguage(choice, browserLanguages()));
    } catch {
      await changeLanguage("en");
    }
  });
  return changes;
}

/** The saved choice: a language code, or null for "Match my device". */
export const currentLanguage = (): string | null => loadLanguage();

/** Saves the choice and shows the page in its language at once, keeping the connection and what is on screen. */
export function chooseLanguage(choice: string | null): Promise<void> {
  saveLanguage(choice);
  return apply(choice);
}

/**
 * Puts the language on the page before the first render, keeps `<html lang>` equal to it, and follows the browser's
 * languages while the choice is "Match my device".
 */
export async function startLanguage(): Promise<void> {
  i18n.on("languageChanged", (language) => {
    document.documentElement.lang = language;
  });
  window.addEventListener("languagechange", () => {
    if (loadLanguage() === null) void apply(null);
  });
  await apply(loadLanguage());
  document.documentElement.lang = i18n.language;
}
