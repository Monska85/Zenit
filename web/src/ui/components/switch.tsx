// SPDX-License-Identifier: GPL-3.0-or-later

import { useId, type ReactNode } from "react";

/**
 * A setting that is on or off, drawn as a switch: a real checkbox with the switch role, transparent over a track whose
 * thumb slides. The label is as large as the row, so the whole row toggles it.
 */
export function SwitchField({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: ReactNode;
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
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.checked)}
          className="peer absolute inset-0 m-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
        />
        <span
          aria-hidden
          className="pointer-events-none inline-flex h-8 w-13 items-center rounded-full bg-muted-foreground p-1 transition-colors peer-checked:bg-primary peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:opacity-50 peer-checked:*:translate-x-5"
        >
          <span className="block size-6 rounded-full bg-card shadow-sm motion-safe:transition-transform" />
        </span>
      </span>
    </label>
  );
}
