// SPDX-License-Identifier: GPL-3.0-or-later

import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface ChoiceOption {
  value: string;
  label: ReactNode;
  /** The name for assistive technology, when the label is not text. */
  name?: string;
  hint?: string;
}

/**
 * A single choice among a few options, as real radio buttons (so arrow keys, focus and screen readers work), drawn as
 * cards. `layout` is the grid the cards sit in.
 */
export function ChoiceGroup({
  legend,
  options,
  value,
  onChange,
  disabled,
  layout = "grid-cols-2",
  hideLegend = false,
  groupName,
}: {
  legend: string;
  options: ChoiceOption[];
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  layout?: string;
  hideLegend?: boolean;
  groupName: string;
}) {
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className={cn("mb-2 text-base font-medium", hideLegend && "sr-only")}>{legend}</legend>
      <div className={cn("grid gap-2", layout)}>
        {options.map((option) => (
          <label key={option.value} className="relative block cursor-pointer">
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              aria-label={option.name}
              className="peer sr-only"
            />
            <span className="flex h-full min-h-11 flex-col justify-center rounded-xl border border-border bg-card px-3 py-2 text-base transition-colors peer-checked:border-primary peer-checked:bg-accent peer-checked:text-accent-foreground peer-checked:ring-2 peer-checked:ring-primary peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:opacity-50">
              {option.label}
              {option.hint && <span className="text-sm text-muted-foreground">{option.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
