// SPDX-License-Identifier: GPL-3.0-or-later

// Word tables are plain objects, and a board may send any word: `constructor` or `toString` must not reach the
// prototype. Every lookup of a word from the board goes through `own`.

/** The table's own value for `key`, or undefined. */
export function own<T>(table: Readonly<Record<string | number, T>>, key: string | number): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}
