// SPDX-License-Identifier: GPL-3.0-or-later

import { useId, useState, type FormEvent } from "react";
import { Button } from "./button";

/**
 * A setting typed in a field and sent with its button, never while typing. `validate` returns the sentence to show, or
 * null when the text can be sent.
 */
export function ValueForm({
  label,
  hint,
  value,
  validate,
  onSubmit,
  inputMode,
  buttonLabel = "Set",
  disabled,
}: {
  label: string;
  hint?: string;
  value: string;
  validate: (text: string) => string | null;
  onSubmit: (text: string) => void;
  inputMode?: "numeric" | "text";
  buttonLabel?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const hintId = useId();
  const [seen, setSeen] = useState(value);
  // What the board holds replaces what was typed
  if (seen !== value) {
    setSeen(value);
    setText(value);
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = text.trim();
    const found = validate(trimmed);
    setProblem(found);
    if (found === null) onSubmit(trimmed);
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 grow">
        <label htmlFor={id} className="mb-1 block text-base font-medium">
          {label}
        </label>
        <input
          id={id}
          type="text"
          inputMode={inputMode}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={text}
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => setText(event.target.value)}
          className="block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base disabled:opacity-50"
        />
      </div>
      <Button type="submit" variant="outline" disabled={disabled}>
        {buttonLabel}
      </Button>
      {hint && (
        <p id={hintId} className="w-full text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {problem && (
        <p role="alert" className="w-full text-base text-danger">
          {problem}
        </p>
      )}
    </form>
  );
}
