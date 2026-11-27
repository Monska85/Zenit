// SPDX-License-Identifier: GPL-3.0-or-later

import { Power } from "lucide-react";
import type { CSSProperties } from "react";
import { own } from "../../lib/own";
import { COLOR_SWATCHES, swatchInk } from "../../light/model";
import { cn } from "../../lib/utils";

/** The fill, edge, icon and glow of a lit button: the color the light shows now, or the brand color for one the app
 * has no swatch for. */
function litStyle(color: string | null): CSSProperties {
  const swatch = color === null ? undefined : own(COLOR_SWATCHES, color);
  if (swatch === undefined) return { "--glow": "var(--primary)" } as CSSProperties;
  return {
    "--glow": swatch,
    background: swatch,
    color: swatchInk(swatch),
    borderColor: `color-mix(in oklab, ${swatch} 65%, var(--foreground))`,
  } as CSSProperties;
}

/**
 * The big on/off button. It is a toggle button: assistive technology reads "Light, pressed" when it is on. Lit, it
 * takes the color the light shows and glows in it; the glow breathes only when the person allows motion.
 */
export function PowerButton({
  on,
  color,
  onToggle,
  disabled,
}: {
  on: boolean;
  /** The color the light shows now, from `status`. */
  color: string | null;
  onToggle: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label="Light"
      disabled={disabled}
      onClick={() => onToggle(!on)}
      style={on ? litStyle(color) : undefined}
      data-testid="power-button"
      className={cn(
        "flex size-24 shrink-0 items-center justify-center rounded-full border-4 transition-colors disabled:opacity-50",
        on
          ? "glow border-primary bg-primary text-primary-foreground motion-safe:animate-[glow_4s_ease-in-out_infinite]"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      <Power aria-hidden className="size-11" />
    </button>
  );
}
