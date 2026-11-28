// SPDX-License-Identifier: GPL-3.0-or-later

// The confirmation shown in the bottom message after something the person did worked ("Saved Bedtime."): one at a time,
// gone after a few seconds, kept as a message and translated where it is shown. Errors are not here: they are the
// session's own `error`.
//
// This store is part of the page, not of the session: the session knows nothing of it. Whoever shows a confirmation
// calls `showNotice` (the Favorites card, for a request that closes its dialog); the timer clears it after NOTICE_MS,
// and the shell (ui/app.tsx) clears it on every change of the connection phase, so a confirmation never outlives the
// connection it was about.

import { useSyncExternalStore } from "react";
import type { Message } from "../i18n";

/** How long a confirmation stays, in ms. */
export const NOTICE_MS = 4000;

let current: Message | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function set(text: Message | null): void {
  current = text;
  for (const listener of listeners) listener();
}

export function clearNotice(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  set(null);
}

/** Shows `text`, in place of an earlier confirmation, for NOTICE_MS. */
export function showNotice(text: Message): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(clearNotice, NOTICE_MS);
  set(text);
}

/** The confirmation now, outside React (the hook below is for components). */
export const currentNotice = (): Message | null => current;

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The confirmation to show now, or null. */
export const useNotice = (): Message | null =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
