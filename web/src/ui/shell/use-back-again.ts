// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from "react";
import type { BoardState } from "../../board/session";

/** How long a confirmation stays at the bottom of the screen. */
const CONFIRMATION_MS = 4000;

type Phase = BoardState["phase"];

/** What the confirmation knows: whether the connection was lost and is not back yet, and whether it shows now. */
export interface BackAgain {
  wasLost: boolean;
  shown: boolean;
}

/**
 * The next state when the phase or the opening flag changes. Reconnect closes the lost connection first
 * ("disconnected" while a new one is opening), then passes through "connecting" (and "login"): the loss is remembered
 * until the connection is back, or until nothing is opening any more without a connection (a Disconnect, or a
 * Reconnect that failed), so a later connection to any board is not called "again".
 */
export function backAgainStep(state: BackAgain, phase: Phase, opening: boolean): BackAgain {
  if (phase === "lost") return { wasLost: true, shown: false };
  if (phase === "connected") return { wasLost: false, shown: state.wasLost || state.shown };
  if (phase === "disconnected" && !opening) return { wasLost: false, shown: false };
  return { wasLost: state.wasLost, shown: false };
}

/** "Connected again." for a few seconds when a lost connection comes back, by itself or by Reconnect. */
export function useBackAgain(phase: Phase, opening: boolean): [boolean, () => void] {
  const [state, setState] = useState<BackAgain>({ wasLost: false, shown: false });
  const [seen, setSeen] = useState({ phase, opening });
  // Adjusted while rendering, from what this hook saw last (react.dev: "storing information from previous renders")
  if (phase !== seen.phase || opening !== seen.opening) {
    setSeen({ phase, opening });
    setState(backAgainStep(state, phase, opening));
  }
  const { shown } = state;
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setState((current) => ({ ...current, shown: false })), CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  return [shown, () => setState((current) => ({ ...current, shown: false }))];
}
