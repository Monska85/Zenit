// SPDX-License-Identifier: GPL-3.0-or-later

import { useId } from "react";

/** A text cut to its first `max` characters (code points, as the board counts them: an emoji is one). */
export const clipName = (text: string, max: number): string => {
  const characters = [...text];
  return characters.length <= max ? text : characters.slice(0, max).join("");
};

/**
 * The Name field of the save dialog and of a favorite's sheet. It stops at `max` characters, so the sentence about a name
 * that is too long shows only for a paste the field could not cut; `problem` is the sentence under the field.
 */
export function FavoriteNameField({
  value,
  max,
  problem,
  disabled,
  autoFocus,
  hint,
  onChange,
}: {
  value: string;
  max: number;
  problem: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
  hint?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const hintId = useId();
  const problemId = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-base font-medium">
        Name
      </label>
      <input
        id={id}
        type="text"
        autoCapitalize="sentences"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        data-autofocus={autoFocus ? "" : undefined}
        aria-invalid={problem !== null}
        aria-describedby={[hint ? hintId : null, problem ? problemId : null].filter(Boolean).join(" ") || undefined}
        onChange={(event) => onChange(clipName(event.target.value, max))}
        className="block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base disabled:opacity-50"
      />
      {hint && (
        <p id={hintId} className="mt-1 text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {problem && (
        <p id={problemId} role="alert" className="mt-1 text-base text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}
