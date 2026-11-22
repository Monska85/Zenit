// SPDX-License-Identifier: GPL-3.0-or-later

import { useRef, useState } from "react";
import type { Settings } from "../../protocol/types";
import { useBoard } from "../board-context";
import { CommitTracker } from "./commit-tracker";

/**
 * What the user chose and the board has not confirmed yet is shown at once (`pending`); the board's reply replaces it.
 * Only the latest commit of a setting clears it: an earlier one that ends late leaves the later choice showing.
 */
export function useCommit(): { pending: Partial<Settings>; commit: (patch: Partial<Settings>) => Promise<void> } {
  const { session } = useBoard();
  const [pending, setPending] = useState<Partial<Settings>>({});
  const tracker = useRef(new CommitTracker());
  const commit = async (patch: Partial<Settings>): Promise<void> => {
    setPending((current) => ({ ...current, ...patch }));
    const finish = tracker.current.start(Object.keys(patch));
    try {
      await session.setSettings(patch);
    } finally {
      const done = finish();
      setPending((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !done.includes(key))));
    }
  };
  return { pending, commit };
}
