// SPDX-License-Identifier: GPL-3.0-or-later

// The app's text (docs/adr/0007-translations.md). English is the source language, bundled with the app; another
// language is a folder of ../locales/ with the same files, loaded as its own chunk only when it is chosen. Nothing is
// ever fetched from another site.
//
// One instance for the whole page. Components translate with `useTranslation`, which renders them again when the
// language changes; plain modules (the models, the session) call `i18n.t` when they make a sentence. A sentence kept
// in state is kept as a Message, its key and values, and translated where it is shown, so a language change reaches
// it too.

import i18next, { type ParseKeys } from "i18next";
import { initReactI18next } from "react-i18next";
import { en, NAMESPACES, type Namespace } from "./resources";

export const SOURCE_LANGUAGE = "en";

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  lng: SOURCE_LANGUAGE,
  fallbackLng: SOURCE_LANGUAGE,
  ns: NAMESPACES,
  defaultNS: "common",
  resources: { [SOURCE_LANGUAGE]: en },
  // English is here already, so the instance is ready when this module has run: no first render without text
  initAsync: false,
  // Every translated string is rendered as React text, which React escapes; escaping here too would show "&amp;"
  // A value is never read as a key or a nesting (a favorite named "$t(...)" or "{{x}}" stays as typed)
  interpolation: { escapeValue: false, skipOnVariables: true },
  returnNull: false,
  react: { useSuspense: false },
});

const folder = (path: string): string => /\/locales\/([^/]+)\//.exec(path)?.[1] ?? "";

// The other languages' files, each loaded only when its language is chosen
const loaders = import.meta.glob<{ default: Record<string, unknown> }>([
  "../locales/*/*.json",
  "!../locales/en/*.json",
]);

/** The languages the app has a catalog for, English first. */
export const LANGUAGES: readonly string[] = [
  SOURCE_LANGUAGE,
  ...new Set(
    Object.keys(loaders)
      .map(folder)
      .filter((language) => language !== SOURCE_LANGUAGE)
      .sort(),
  ),
];

const primary = (tag: string): string => tag.trim().toLowerCase().split("-")[0] ?? "";

/**
 * The language to show: the saved choice when the app has it, else the first of the browser's languages whose primary
 * subtag has a catalog ("it-CH" gives "it"), else English.
 */
export function resolveLanguage(
  saved: string | null,
  browser: readonly string[],
  available: readonly string[] = LANGUAGES,
): string {
  if (saved !== null && available.includes(saved)) return saved;
  for (const tag of browser) {
    const language = primary(tag);
    if (available.includes(language)) return language;
  }
  return SOURCE_LANGUAGE;
}

/** Loads the catalogs of `language` when they are not here yet, then switches to it. */
export async function changeLanguage(language: string): Promise<void> {
  if (!LANGUAGES.includes(language)) language = SOURCE_LANGUAGE;
  if (!i18n.hasResourceBundle(language, "common")) {
    const files = Object.entries(loaders).filter(([path]) => folder(path) === language);
    const loaded = await Promise.all(files.map(async ([path, load]) => [path, (await load()).default] as const));
    for (const [path, data] of loaded) {
      const namespace = /\/([^/]+)\.json$/.exec(path)?.[1] as Namespace;
      i18n.addResourceBundle(language, namespace, data);
    }
  }
  await i18n.changeLanguage(language);
}

/** A key of any namespace, written "namespace:key". */
export type MessageKey = { [N in Namespace]: `${N}:${ParseKeys<N>}` }[Namespace];

/** A sentence kept for later: translated when it is shown, in the language of that moment. */
export interface Message {
  key: MessageKey;
  values?: Record<string, string | number>;
}

export const message = (key: MessageKey, values?: Record<string, string | number>): Message =>
  values === undefined ? { key } : { key, values };

/** The text of a message in the active language. */
export const translate = (text: Message): string =>
  // The key was checked where the message was made; `t` takes one namespace's keys at a time
  i18n.t(text.key as ParseKeys, text.values ?? {});

/**
 * The locale for dates: the browser's own tag when it is a variant of the active language (en-GB keeps its day-first
 * dates in English), else the active language.
 */
export function dateLocale(browser: readonly string[]): string {
  return browser.find((tag) => primary(tag) === i18n.language) ?? i18n.language;
}

/** A number in the active language's digits and separators. */
export const formatNumber = (value: number, options?: Intl.NumberFormatOptions): string =>
  new Intl.NumberFormat(i18n.language, options).format(value);
