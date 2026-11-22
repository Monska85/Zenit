// SPDX-License-Identifier: GPL-3.0-or-later

import { useId } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

/** A choice among many options, as the browser's own select (it works on every phone and with the keyboard). */
export function SelectField({
  label,
  hint,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-base font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && (
        <p id={hintId} className="mt-1 text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
