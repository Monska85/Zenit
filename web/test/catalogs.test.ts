// SPDX-License-Identifier: GPL-3.0-or-later

// Every language folder of src/locales/ against English: a new language is checked with no new test code.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogProblems, type Catalog } from "./catalog-check";

const LOCALES = join(import.meta.dirname, "..", "src", "locales");
const files = (language: string): string[] =>
  readdirSync(join(LOCALES, language))
    .filter((name) => name.endsWith(".json"))
    .sort();
const read = (language: string, file: string): Catalog =>
  JSON.parse(readFileSync(join(LOCALES, language, file), "utf8")) as Catalog;
const languages = readdirSync(LOCALES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe("catalogs", () => {
  it("have English, the source language", () => {
    expect(languages).toContain("en");
    expect(files("en").length).toBeGreaterThan(0);
  });

  describe.each(languages)("%s", (language) => {
    it("has the same files as English", () => {
      expect(files(language)).toEqual(files("en"));
    });

    it.each(files("en"))(
      "%s has every key, plural form and placeholder of English, and no empty or punctuation-only text",
      (file) => {
        expect(catalogProblems(read("en", file), read(language, file), language)).toEqual([]);
      },
    );
  });
});

describe("catalogProblems", () => {
  const english = {
    title: "Light",
    saved: "Saved {{name}}.",
    group: { hint: "Try {{value}} %." },
    hours_one: "Every hour",
    hours_other: "Every {{count}} hours",
    left_one: "{{name}}: {{count}} left",
    left_other: "{{name}}: {{count}} left",
  };

  it("finds nothing wrong with a full translation, whose plural forms follow its own language", () => {
    const italian = {
      title: "Luce",
      saved: "{{name}} salvato.",
      group: { hint: "Prova {{value}} %." },
      hours_one: "Ogni ora",
      hours_many: "Ogni {{count}} ore",
      hours_other: "Ogni {{count}} ore",
      left_one: "{{name}}: ne resta {{count}}",
      left_many: "{{name}}: ne restano {{count}}",
      left_other: "{{name}}: ne restano {{count}}",
    };
    expect(catalogProblems(english, italian, "it")).toEqual([]);
    expect(catalogProblems(english, english, "en")).toEqual([]);
  });

  it("names a missing key, an extra key, an empty text, markup, punctuation alone and a value that is not a text", () => {
    const broken = {
      saved: " ",
      group: { hint: "<b>Try</b> {{value}} %." },
      extra: "x",
      hours_one: "Ogni ora",
      hours_many: "Ogni {{count}} ore",
      hours_other: "Ogni {{count}} ore",
      left_one: "{{name}}: ne resta {{count}}",
      left_many: "{{name}}: ne restano {{count}}",
      left_other: "{{name}}: ne restano {{count}}",
      list: ["a"],
      title: " · ",
    };
    expect(catalogProblems(english, broken, "it")).toEqual([
      "list: not a text",
      "saved: empty",
      "group.hint: markup",
      "extra: not in English",
      "title: punctuation only",
      "saved: placeholders  instead of name",
    ]);
  });

  it("names a plural form the language lacks or does not have, and a placeholder lost or renamed", () => {
    const italian = {
      title: "Luce",
      saved: "{{nome}} salvato.",
      group: { hint: "Prova %." },
      hours_one: "Ogni ora",
      hours_few: "Ogni {{count}} ore",
      hours_other: "Ogni {{count}} ore",
      left_one: "ne resta {{count}}",
      left_many: "{{name}}: ne restano {{count}}",
      left_other: "{{name}}: ne restano {{count}}",
    };
    expect(catalogProblems(english, italian, "it")).toEqual([
      "hours_few: not a plural form of it",
      "saved: placeholders nome instead of name",
      "group.hint: placeholders  instead of value",
      "hours_many: missing",
      "left_one: placeholders  instead of name",
    ]);
  });
});
