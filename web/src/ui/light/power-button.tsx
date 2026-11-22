// SPDX-License-Identifier: GPL-3.0-or-later

import { Power } from "lucide-react";
import { cn } from "../../lib/utils";

/** The big on/off button. It is a toggle button: assistive technology reads "Light, pressed" when it is on. */
export function PowerButton({
  on,
  onToggle,
  disabled,
}: {
  on: boolean;
  onToggle: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        aria-pressed={on}
        aria-label="Light"
        disabled={disabled}
        onClick={() => onToggle(!on)}
        className={cn(
          "flex size-32 items-center justify-center rounded-full border-4 transition-colors disabled:opacity-50",
          on
            ? "border-primary bg-primary text-primary-foreground shadow-[0_0_40px_var(--primary)]"
            : "border-border bg-muted text-muted-foreground",
        )}
      >
        <Power aria-hidden className="size-14" />
      </button>
      <span className="text-xl font-semibold" data-testid="power-state">
        {on ? "On" : "Off"}
      </span>
    </div>
  );
}
