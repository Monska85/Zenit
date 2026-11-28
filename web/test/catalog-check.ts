// SPDX-License-Identifier: GPL-3.0-or-later

// The checks every language's catalogs must pass against English (docs/adr/0007-translations.md): the same keys, every
// plural form the language has, the same placeholders, no empty text and no markup. Kept apart from the test that runs
// them on the real catalogs so they can be tested on fixtures of their own.

export type Catalog = Record<string, unknown>;

const PLURAL = /_(zero|one|two|few|many|other)$/;
const PLACEHOLDER = /\{\{\s*([^}\s,]+)[^}]*\}\}/g;
const MARKUP = /<\/?[A-Za-z][^>]*>|&[a-z]+;|&#/;

/** The catalog's texts by their dotted key path; a value that is not a string or an object is reported. */
export function flatten(catalog: Catalog, problems: string[], prefix = ""): Map<string, string> {
  const texts = new Map<string, string>();
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "string") texts.set(path, value);
    else if (value !== null && typeof value === "object" && !Array.isArray(value))
      for (const [inner, text] of flatten(value as Catalog, problems, path)) texts.set(inner, text);
    else problems.push(`${path}: not a text`);
  }
  return texts;
}

export const placeholders = (text: string): string[] =>
  [...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1] as string))].sort();

/** A key without its plural suffix, when English has an `_other` form for it. */
function baseOf(key: string, englishPlurals: ReadonlySet<string>): string | null {
  const base = key.replace(PLURAL, "");
  return base !== key && englishPlurals.has(base) ? base : null;
}

/** Every problem of `texts` (one namespace of `language`) against the English namespace; none when they agree. */
export function catalogProblems(english: Catalog, other: Catalog, language: string): string[] {
  const problems: string[] = [];
  const source = flatten(english, problems);
  const target = flatten(other, problems);
  const plurals = new Set([...source.keys()].filter((key) => key.endsWith("_other")).map((key) => key.slice(0, -6)));
  const categories = new Intl.PluralRules(language).resolvedOptions().pluralCategories;

  for (const [key, text] of target) {
    if (text.trim() === "") problems.push(`${key}: empty`);
    if (MARKUP.test(text)) problems.push(`${key}: markup`);
    const base = baseOf(key, plurals);
    if (base === null) {
      if (!source.has(key)) problems.push(`${key}: not in English`);
      continue;
    }
    if (!(categories as readonly string[]).includes(key.slice(base.length + 1)))
      problems.push(`${key}: not a plural form of ${language}`);
  }

  for (const [key, text] of source) {
    if (baseOf(key, plurals) !== null) continue;
    const translated = target.get(key);
    if (translated === undefined) problems.push(`${key}: missing`);
    else if (placeholders(translated).join() !== placeholders(text).join())
      problems.push(`${key}: placeholders ${placeholders(translated).join()} instead of ${placeholders(text).join()}`);
  }

  for (const base of plurals) {
    // A form may leave out {{count}} ("Every hour"), but every other placeholder is in each form
    const wanted = placeholders(source.get(`${base}_other`) as string).filter((name) => name !== "count");
    for (const category of categories) {
      const translated = target.get(`${base}_${category}`);
      if (translated === undefined) problems.push(`${base}_${category}: missing`);
      else {
        const others = placeholders(translated).filter((name) => name !== "count");
        if (others.join() !== wanted.join())
          problems.push(`${base}_${category}: placeholders ${others.join()} instead of ${wanted.join()}`);
      }
    }
  }
  return problems;
}
