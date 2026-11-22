// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useRef, useState } from "react";
import { Slider } from "../components/slider";
import { CommitTracker } from "./commit-tracker";

/** How long the keyboard waits after its last key before the value is sent: each key press would be a save. */
export const KEY_PAUSE_MS = 500;

/**
 * A setting with a slider. While the thumb moves the value shown is the one being chosen and nothing is sent; the
 * value is sent when the pointer is released, or a moment after the last key press.
 */
export function SettingSlider({
  label,
  value,
  min,
  max,
  format,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  format: (value: number) => string;
  onCommit: (value: number) => Promise<void>;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const pointer = useRef(false);
  const pause = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The value a key press chose and the pause has not sent yet. */
  const waiting = useRef<number | null>(null);
  // Only the latest commit clears the draft: an earlier one that ends late must not drop the value now being shown
  const tracker = useRef(new CommitTracker());
  const commitNow = (next: number): void => {
    const finish = tracker.current.start(["value"]);
    void onCommit(next).finally(() => {
      if (finish().length > 0) setDraft(null);
    });
  };
  const send = useRef(commitNow);
  const shown = draft ?? value;

  // The latest onCommit, for a flush that runs from a timer or a cleanup
  useEffect(() => {
    send.current = commitNow;
  });

  /** Sends what the pause is holding now: the focus leaves the slider, or the view closes. */
  const flush = useRef((): void => {
    if (pause.current !== null) clearTimeout(pause.current);
    pause.current = null;
    const next = waiting.current;
    waiting.current = null;
    if (next !== null) send.current(next);
  });

  useEffect(() => {
    const now = flush.current;
    return () => now();
  }, []);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-base font-medium" aria-hidden>
          {label}
        </span>
        <span className="text-base tabular-nums text-muted-foreground" aria-hidden>
          {format(shown)}
        </span>
      </div>
      <Slider
        label={label}
        valueText={format(shown)}
        min={min}
        max={max}
        step={1}
        value={[shown]}
        disabled={disabled}
        onPointerDown={() => {
          pointer.current = true;
          // A press that moves nothing commits nothing, so the end of the press clears the flag, wherever it ends
          const clear = (): void => {
            pointer.current = false;
            window.removeEventListener("pointerup", clear);
            window.removeEventListener("pointercancel", clear);
          };
          window.addEventListener("pointerup", clear);
          window.addEventListener("pointercancel", clear);
        }}
        onBlur={() => {
          pointer.current = false;
          flush.current();
        }}
        onValueChange={([next]) => {
          if (next !== undefined) setDraft(next);
        }}
        onValueCommit={([next]) => {
          if (next === undefined) return;
          if (pause.current !== null) clearTimeout(pause.current);
          pause.current = null;
          if (pointer.current) {
            pointer.current = false;
            waiting.current = null;
            send.current(next);
          } else {
            waiting.current = next;
            pause.current = setTimeout(() => flush.current(), KEY_PAUSE_MS);
          }
        }}
      />
    </div>
  );
}
