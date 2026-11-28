// SPDX-License-Identifier: GPL-3.0-or-later

import { AlertTriangle, Info, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";

type Tone = "error" | "warning" | "info";

const TONES: Record<Tone, string> = {
  error: "border-danger bg-danger-soft text-foreground",
  warning: "border-warning-border bg-warning-soft text-foreground",
  info: "border-border bg-muted text-foreground",
};

/** A box with a message. Errors are announced at once (`alert`); the other tones are read when the user reaches them. */
export function Banner({
  tone,
  children,
  onClose,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cn("flex items-start gap-3 rounded-xl border p-3 text-base", TONES[tone], className)}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 grow">{children}</div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={t("buttons.closeMessage")}
          className="-m-2 flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
        >
          <X aria-hidden className="size-5" />
        </button>
      )}
    </div>
  );
}
