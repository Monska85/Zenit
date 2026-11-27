// SPDX-License-Identifier: GPL-3.0-or-later

import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * A short message anchored to the bottom of the screen, where a thumb on a phone already is: above the tab bar on a
 * phone, at the bottom of the window on a wide screen. An error is announced at once (`alert`). A confirmation is
 * announced by a live region the caller keeps in the page (a region added with its text may not be read), so it has no
 * role here. Both have a Close button.
 */
export function BottomMessage({
  tone,
  children,
  onClose,
}: {
  tone: "error" | "done";
  children: ReactNode;
  onClose: () => void;
}) {
  const Icon = tone === "error" ? AlertTriangle : CheckCircle2;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-4 sm:bottom-4">
      <div
        role={tone === "error" ? "alert" : undefined}
        data-testid="bottom-message"
        className={cn(
          "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border p-3 text-base text-foreground shadow-lg",
          tone === "error" ? "border-danger bg-danger-soft" : "border-border bg-card",
        )}
      >
        <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 grow">{children}</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close this message"
          className="-m-2 flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>
    </div>
  );
}
