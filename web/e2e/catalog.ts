// SPDX-License-Identifier: GPL-3.0-or-later

// The app's text in a given language, read from its catalogs, for the tests that run the app in that language.

import { readFileSync } from "node:fs";
import { join } from "node:path";

type Tree = { [key: string]: string | Tree };

const cache = new Map<string, Tree>();

function catalog(language: string, namespace: string): Tree {
  const file = join(import.meta.dirname, "..", "src", "locales", language, `${namespace}.json`);
  let tree = cache.get(file);
  if (tree === undefined) {
    tree = JSON.parse(readFileSync(file, "utf8")) as Tree;
    cache.set(file, tree);
  }
  return tree;
}

/** The text of `"namespace:key.path"` in `language`, with its `{{placeholders}}` filled from `values`. */
export function text(language: string, key: string, values: Record<string, string | number> = {}): string {
  const [namespace, path] = key.split(":") as [string, string];
  let node: string | Tree | undefined = catalog(language, namespace);
  for (const part of path.split(".")) node = typeof node === "object" ? node[part] : undefined;
  if (typeof node !== "string") throw new Error(`no text for ${key} in ${language}`);
  return node.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(values[name] ?? `{{${name}}}`));
}

/** The texts of one language, for a test that only uses that one. */
export const textsOf =
  (language: string) =>
  (key: string, values?: Record<string, string | number>): string =>
    text(language, key, values);
