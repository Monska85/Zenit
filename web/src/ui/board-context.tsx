// SPDX-License-Identifier: GPL-3.0-or-later

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { pageVisibility } from "../board/connect";
import { BoardSession, type BoardState } from "../board/session";

const SessionContext = createContext<BoardSession | null>(null);

export const session = new BoardSession(pageVisibility);

export function BoardProvider({ children, value = session }: { children: ReactNode; value?: BoardSession }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** The connection to the board: what the app knows of it, and the session to act on it. */
export function useBoard(): { board: BoardState; session: BoardSession } {
  const current = useContext(SessionContext);
  if (!current) throw new Error("useBoard needs a BoardProvider");
  const board = useSyncExternalStore(current.subscribe, current.getState);
  return { board, session: current };
}
