// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { dateLocale, i18n, LANGUAGES, message, resolveLanguage, SOURCE_LANGUAGE, translate } from "../src/i18n";

describe("i18n", () => {
  it("is ready in English as soon as it is imported", () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.language).toBe(SOURCE_LANGUAGE);
    expect(LANGUAGES[0]).toBe("en");
    expect(i18n.t("errors:noAnswer")).toBe("Zenit did not answer. Check the cable or the address.");
  });

  it("translates a message with its values, and leaves text from the board as it is", () => {
    expect(translate(message("errors:refused", { code: "<b>new</b>" }))).toBe(
      "Zenit refused the request (<b>new</b>).",
    );
    // A value is never read as a placeholder, a nesting or a key
    for (const code of ["{{code}}", "$t(errors:unknown)", "errors:noAnswer"])
      expect(translate(message("errors:refused", { code }))).toBe(`Zenit refused the request (${code}).`);
  });

  it("writes dates in the browser's own variant of the active language, else in the active language", () => {
    expect(dateLocale(["en-GB", "it-IT"])).toBe("en-GB");
    expect(dateLocale(["it-IT", "en-AU"])).toBe("en-AU");
    expect(dateLocale(["it-IT"])).toBe("en");
    expect(dateLocale([])).toBe("en");
  });
});

describe("resolveLanguage", () => {
  const available = ["en", "it"];

  it("takes the saved choice first, when the app has it", () => {
    expect(resolveLanguage("it", ["en-US"], available)).toBe("it");
    expect(resolveLanguage("en", ["it-IT"], available)).toBe("en");
    expect(resolveLanguage("fr", ["it-IT"], available)).toBe("it");
  });

  it("then the first browser language whose primary subtag has a catalog", () => {
    expect(resolveLanguage(null, ["fr-FR", "it-CH", "en"], available)).toBe("it");
    expect(resolveLanguage(null, ["IT"], available)).toBe("it");
    expect(resolveLanguage(null, ["en-GB", "it"], available)).toBe("en");
  });

  it("else English", () => {
    expect(resolveLanguage(null, [], available)).toBe("en");
    expect(resolveLanguage(null, ["fr", "de-CH", ""], available)).toBe("en");
    expect(resolveLanguage(null, ["it-IT"], ["en"])).toBe("en");
  });
});
