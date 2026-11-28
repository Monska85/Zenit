// SPDX-License-Identifier: GPL-3.0-or-later

import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "../../i18n";
import { LIMITS, TIMER_PRESETS, customTimerLabel, formatSeconds, formatTimer } from "../../light/model";
import type { LightStatus } from "../../protocol/types";
import { Button } from "../components/button";
import { Card, CardTitle } from "../components/card";
import { ChoiceGroup } from "../components/choice";

const isPreset = (minutes: number): boolean => (TIMER_PRESETS as readonly number[]).includes(minutes);

/** The line under the choices: the time left, or that the timer ended. Nothing while there is nothing to say. */
export function timerLine(light: LightStatus): string | null {
  if (light.timer === null) return null;
  if (light.timer.remaining > 0)
    return light.on ? i18n.t("light:timer.fadesOut", { time: formatSeconds(light.timer.remaining) }) : null;
  return i18n.t("light:timer.ended");
}

/** The timer line as a screen reader hears it: in the last minute it does not count every second. */
export function timerLineSpoken(light: LightStatus): string | null {
  if (light.timer !== null && light.on && light.timer.remaining > 0 && light.timer.remaining < 60)
    return i18n.t("light:timer.fadesOutSoon");
  return timerLine(light);
}

export function TimerCard({
  minutes,
  light,
  onChange,
}: {
  minutes: number;
  light: LightStatus;
  onChange: (minutes: number) => Promise<void>;
}) {
  const { t } = useTranslation("light");
  const [custom, setCustom] = useState(false);
  const [text, setText] = useState("");
  /** The number typed is not one the timer takes. */
  const [problem, setProblem] = useState(false);
  const fieldId = useId();
  const customShown = custom || (minutes !== 0 && !isPreset(minutes));
  const selected = customShown ? "custom" : String(minutes);
  const line = timerLine(light);
  const spoken = timerLineSpoken(light);

  function choose(value: string): void {
    setProblem(false);
    if (value === "custom") {
      setCustom(true);
      if (text === "" && minutes !== 0) setText(String(minutes));
      return;
    }
    setCustom(false);
    void onChange(Number(value));
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    const value = Number(text);
    if (!/^[0-9]+$/.test(text.trim()) || value < 1 || value > LIMITS.timer_minutes.max) {
      setProblem(true);
      return;
    }
    setProblem(false);
    void onChange(value);
  }

  return (
    <Card aria-labelledby="timer-title">
      <CardTitle id="timer-title">{t("timer.title")}</CardTitle>
      <ChoiceGroup
        legend={t("timer.title")}
        hideLegend
        groupName="timer"
        value={selected}
        onChange={choose}
        layout="grid-cols-3"
        options={[
          { value: "0", label: t("timer.off") },
          ...TIMER_PRESETS.map((preset) => ({ value: String(preset), label: formatTimer(preset) })),
          { value: "custom", label: customTimerLabel(minutes) },
        ]}
      />
      {customShown && (
        <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="grow">
            <label htmlFor={fieldId} className="mb-1 block text-base font-medium">
              {t("timer.minutesLabel", { max: LIMITS.timer_minutes.max })}
            </label>
            <input
              id={fieldId}
              type="text"
              inputMode="numeric"
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base"
            />
          </div>
          <Button type="submit">{t("timer.set")}</Button>
          {problem && (
            <p role="alert" className="w-full text-base text-danger">
              {t("timer.wholeMinutes", { max: LIMITS.timer_minutes.max })}
            </p>
          )}
        </form>
      )}
      {/* The live region stays in the page so it can speak; empty, it takes no room */}
      <p role="status" className="text-base text-muted-foreground">
        {line !== null && (
          <span aria-hidden className="mt-3 block" data-testid="timer-line">
            {line}
          </span>
        )}
        <span className="sr-only">{spoken}</span>
      </p>
    </Card>
  );
}
