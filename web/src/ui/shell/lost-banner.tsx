// SPDX-License-Identifier: GPL-3.0-or-later

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useBoard } from "../board-context";
import { Button } from "../components/button";

/**
 * The one message of a lost connection, above the view: why, that the values are the last ones reported, and
 * Reconnect. While the connection is opened again by itself it says so instead, with no button.
 */
export function LostBanner() {
  const { board, session } = useBoard();
  if (board.phase !== "lost") return null;
  if (board.auto !== null) {
    return (
      <div
        role="status"
        data-testid="auto-reconnect"
        className="flex items-start gap-3 rounded-xl border border-border bg-muted p-3 text-base"
      >
        <RefreshCw aria-hidden className="mt-0.5 size-5 shrink-0 motion-safe:animate-spin" />
        <p>
          {board.auto === "restarting"
            ? "Zenit is restarting. It connects again by itself in a few seconds."
            : "Connecting to Zenit again..."}
        </p>
      </div>
    );
  }
  return (
    <div
      role="alert"
      data-testid="connection-lost"
      className="flex flex-col gap-3 rounded-xl border border-warning-border bg-warning-soft p-3 text-base sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 grow items-start gap-3">
        <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
        <p>
          <strong className="font-semibold">Connection lost.</strong> {board.error ?? "Zenit did not answer."} These are
          the last values Zenit reported.
        </p>
      </div>
      <Button
        variant="outline"
        className="shrink-0 self-end sm:self-auto"
        disabled={board.opening}
        onClick={() => void session.reconnect()}
      >
        Reconnect
      </Button>
    </div>
  );
}
