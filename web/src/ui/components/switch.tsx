// SPDX-License-Identifier: GPL-3.0-or-later

import { useId } from "react";

/** A setting that is on or off: a real checkbox with the switch role, in a label as large as the row. */
export function SwitchField({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const hintId = useId();
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 text-base">
      <span>
        <span className="block font-medium">{label}</span>
        {hint && (
          <span id={hintId} className="block text-sm text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.checked)}
        className="size-6 shrink-0 accent-primary"
      />
    </label>
  );
}
