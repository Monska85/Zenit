// SPDX-License-Identifier: GPL-3.0-or-later

import { Fragment, type ReactNode } from "react";

/** The mark around a slot: a private-use character that no catalog, board or person text holds. */
const MARK = "\uE000";
const SLOTS = new RegExp(`${MARK}([^${MARK}]+)${MARK}`);

/** The value to give a placeholder that `Sentence` fills with an element. */
export const slot = (name: string): string => `${MARK}${name}${MARK}`;

/**
 * A translated sentence with elements inside it (a link, a styled name). The catalog keeps the whole sentence as one
 * string, each element as a placeholder; the placeholder gets `slot(name)` when the sentence is translated, and the
 * sentence is cut at those slots here, so no markup is ever translated.
 */
export function Sentence({ text, parts }: { text: string; parts: Record<string, ReactNode> }) {
  // Odd pieces are slot names
  const pieces = text.split(SLOTS);
  return (
    <>
      {pieces.map((piece, index) => (
        <Fragment key={index}>{index % 2 === 0 ? piece : (parts[piece] ?? piece)}</Fragment>
      ))}
    </>
  );
}
