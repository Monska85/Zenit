// SPDX-License-Identifier: GPL-3.0-or-later

// The language of the page (src/lib/language.ts): the saved choice, the browser's languages, English; `<html lang>`;
// the choice kept only in the browser's storage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Page {
  storage: Map<string, string>;
  languages: string[];
  html: { lang: string };
  listeners: Map<string, () => void>;
}

let page: Page;

/** A browser with `languages` and, when given, a saved choice; `broken` storage throws on every access. */
function browser(languages: string[], saved?: string, broken = false): void {
  page = { storage: new Map(), languages, html: { lang: "en" }, listeners: new Map() };
  if (saved !== undefined) page.storage.set("zenit.language", saved);
  const fail = (): never => {
    throw new Error("storage is off");
  };
  vi.stubGlobal("localStorage", {
    getItem: broken ? fail : (key: string) => page.storage.get(key) ?? null,
    setItem: broken ? fail : (key: string, value: string) => page.storage.set(key, value),
  });
  vi.stubGlobal("navigator", {
    get languages() {
      return page.languages;
    },
    get language() {
      return page.languages[0] ?? "";
    },
  });
  vi.stubGlobal("document", { documentElement: page.html });
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: () => void) => page.listeners.set(type, listener),
  });
}

/** A fresh page: the modules are loaded again, so each test starts from an English instance. */
async function load() {
  vi.resetModules();
  const language = await import("../src/lib/language");
  const { i18n } = await import("../src/i18n");
  return { ...language, i18n };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => browser(["en-US"]));
afterEach(() => vi.unstubAllGlobals());

describe("the language of the page", () => {
  it("follows the browser's first language that has a catalog, by its primary subtag", async () => {
    browser(["fr-FR", "it-CH", "en"]);
    const { startLanguage, i18n } = await load();
    await startLanguage();
    expect(i18n.language).toBe("it");
    expect(page.html.lang).toBe("it");
    expect(i18n.t("common:language.legend")).not.toBe("Language");
  });

  it("is English for a browser with no language the app has", async () => {
    browser(["fr-FR", "de"]);
    const { startLanguage, i18n } = await load();
    await startLanguage();
    expect(i18n.language).toBe("en");
    expect(page.html.lang).toBe("en");
  });

  it("puts the saved choice before the browser's languages", async () => {
    browser(["it-IT"], "en");
    const { startLanguage, i18n } = await load();
    await startLanguage();
    expect(i18n.language).toBe("en");
  });

  it("ignores a saved choice it has no catalog for", async () => {
    browser(["it-IT"], "xx");
    const { startLanguage, currentLanguage, i18n } = await load();
    await startLanguage();
    expect(i18n.language).toBe("it");
    expect(currentLanguage()).toBe("xx");
  });

  it("changes at once when the person chooses, keeps the choice in the browser and sets <html lang>", async () => {
    const { startLanguage, chooseLanguage, currentLanguage, i18n } = await load();
    await startLanguage();
    expect(i18n.language).toBe("en");
    await chooseLanguage("it");
    expect(i18n.language).toBe("it");
    expect(page.html.lang).toBe("it");
    expect(page.storage.get("zenit.language")).toBe("it");
    expect(currentLanguage()).toBe("it");
    await chooseLanguage("en");
    expect(i18n.language).toBe("en");
    expect(page.html.lang).toBe("en");
  });

  it('goes back to the browser\'s languages with "Match my device", and follows them as they change', async () => {
    browser(["it-IT"], "en");
    const { startLanguage, chooseLanguage, currentLanguage, i18n } = await load();
    await startLanguage();
    await chooseLanguage(null);
    expect(page.storage.get("zenit.language")).toBe("system");
    expect(currentLanguage()).toBeNull();
    expect(i18n.language).toBe("it");
    page.languages = ["en-GB"];
    page.listeners.get("languagechange")?.();
    await settle();
    expect(i18n.language).toBe("en");
  });

  it("keeps a chosen language when the browser's languages change", async () => {
    browser(["en-US"], "it");
    const { startLanguage, i18n } = await load();
    await startLanguage();
    page.languages = ["en-GB"];
    page.listeners.get("languagechange")?.();
    await settle();
    expect(i18n.language).toBe("it");
  });

  it("ends in the language chosen last when a change comes while another language still loads", async () => {
    browser(["en-GB"]);
    const { startLanguage, chooseLanguage, i18n } = await load();
    await startLanguage();
    page.languages = ["it-IT"];
    page.listeners.get("languagechange")?.();
    await chooseLanguage("en");
    await settle();
    expect(i18n.language).toBe("en");
    expect(page.html.lang).toBe("en");
  });

  it("works with no storage: the browser's languages, and a choice that lasts for the page", async () => {
    browser(["it-IT"], undefined, true);
    const { startLanguage, chooseLanguage, i18n } = await load();
    await startLanguage();
    expect(i18n.language).toBe("it");
    await chooseLanguage("en");
    expect(i18n.language).toBe("en");
  });
});

describe("languageName", () => {
  it("names each language in that language, with a capital first letter", async () => {
    const { languageName, LANGUAGES } = await import("../src/i18n");
    expect(LANGUAGES).toEqual(["en", "it"]);
    expect(languageName("en")).toBe("English");
    expect(languageName("it")).toBe("Italiano");
  });
});
