// SPDX-License-Identifier: GPL-3.0-or-later

import { ChevronDown, Monitor, Moon, Sun, Unplug } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { boardName, type BoardState } from "../../board/session";
import { chooseTheme, currentTheme } from "../../lib/theme";
import type { ThemeChoice } from "../../lib/storage";
import { cn } from "../../lib/utils";
import { useBoard } from "../board-context";
import { Button } from "../components/button";
import type { Route } from "../route";

const THEMES: Array<{ choice: ThemeChoice; label: string; Icon: typeof Sun }> = [
  { choice: "system", label: "Match my device", Icon: Monitor },
  { choice: "light", label: "Light", Icon: Sun },
  { choice: "dark", label: "Dark", Icon: Moon },
];

type Dot = "ok" | "wait" | "off";

const DOTS: Record<Dot, string> = {
  ok: "bg-green-600 dark:bg-green-400",
  wait: "bg-amber-500 dark:bg-amber-400",
  off: "bg-muted-foreground",
};

/** The pill's words and dot for each phase. The dot only repeats what the words say. */
export function pillState(board: BoardState): { text: string; dot: Dot } {
  switch (board.phase) {
    case "connecting":
      return { text: "Connecting...", dot: "wait" };
    case "login":
      return { text: "Log in needed", dot: "wait" };
    case "connected":
      return { text: board.kind === "usb" ? "USB" : "WiFi", dot: "ok" };
    case "lost":
      if (board.auto === "restarting") return { text: "Restarting...", dot: "wait" };
      if (board.auto === "reconnecting") return { text: "Reconnecting...", dot: "wait" };
      return { text: "Not connected", dot: "off" };
    default:
      return { text: "Not connected", dot: "off" };
  }
}

/**
 * The connection in a compact pill that opens a small panel: how Zenit is connected, the theme choice and Disconnect.
 * It is a disclosure (a button that shows a panel), not an ARIA menu: the panel holds a group of radio buttons.
 */
export function StatusMenu({ go }: { go: (route: Route) => void }) {
  const { board, session } = useBoard();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>(currentTheme);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const { text, dot } = pillState(board);
  const name = board.phase === "connected" ? boardName(board) : null;
  // A page served by a Zenit has no other place to connect to
  const canDisconnect =
    board.served === null && (board.phase === "connected" || board.phase === "login" || board.phase === "lost");

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent): void => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setOpen(false);
      pill.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(event) => {
        // Focus that moves to something outside closes it. With no next element (Safari does not focus a tapped button
        // or radio) it stays open: a tap outside is caught by the pointer listener.
        const next = event.relatedTarget as Node | null;
        if (next !== null && !event.currentTarget.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={pill}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        title={board.phase === "connected" ? board.label : undefined}
        aria-label={`Connection: ${text}${name === null ? "" : ` · ${name}`}`}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 max-w-[14rem] items-center gap-2 rounded-full border border-border bg-card px-3 text-sm font-medium hover:bg-muted sm:max-w-xs"
      >
        <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", DOTS[dot])} />
        <span className="truncate" data-testid="connection">
          {text}
          {name !== null && (
            <>
              {" · "}
              <span data-testid="hostname">{name}</span>
            </>
          )}
        </span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute top-full right-0 z-40 mt-2 w-64 rounded-2xl border border-border bg-card p-3 shadow-xl"
      >
        {board.phase === "connected" && (
          <p className="mb-3 text-base">
            {board.kind === "usb" ? "Connected by USB" : "Connected over WiFi"}
            {name !== null && (
              <>
                {" to "}
                <span className="font-medium whitespace-nowrap">{name}</span>
              </>
            )}
            .
          </p>
        )}
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-muted-foreground">Theme</legend>
          {THEMES.map(({ choice, label, Icon }) => (
            <label
              key={choice}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted"
            >
              <input
                type="radio"
                name="theme"
                value={choice}
                checked={theme === choice}
                onChange={() => {
                  chooseTheme(choice);
                  setTheme(choice);
                }}
                className="size-4 accent-[var(--primary)]"
              />
              <Icon aria-hidden className="size-5" />
              {label}
            </label>
          ))}
        </fieldset>
        {canDisconnect && (
          <Button
            variant="outline"
            className="mt-3 w-full"
            onClick={() => {
              setOpen(false);
              // The button is about to be hidden: the focus goes back to the pill, not to the top of the page
              pill.current?.focus();
              void session.disconnect();
              go("connect");
            }}
          >
            <Unplug aria-hidden className="size-5" />
            Disconnect
          </Button>
        )}
      </div>
    </div>
  );
}
