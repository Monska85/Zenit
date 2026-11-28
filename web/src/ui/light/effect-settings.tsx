// SPDX-License-Identifier: GPL-3.0-or-later

import { own } from "../../lib/own";
import { Check } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { message, translate, type Message } from "../../i18n";
import {
  COLOR_SET_COLORS,
  COLOR_SWATCHES,
  LIMITS,
  colorLabel,
  colorSetLabel,
  effectControls,
  formatHold,
  formatPercent,
  formatWholeSeconds,
  patternHint,
  patternLabel,
  type ParamName,
  type Settings,
} from "../../light/model";
import type { BoardInfo } from "../../protocol/types";
import { Banner } from "../components/banner";
import { ChoiceGroup } from "../components/choice";
import { cn } from "../../lib/utils";
import { SettingSlider } from "./setting-slider";

type Commit = (patch: Partial<Settings>) => Promise<void>;

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-6 shrink-0 rounded-full border border-black/20"
      style={{ background: own(COLOR_SWATCHES, color) ?? "var(--muted)" }}
    />
  );
}

function ColorChoice({ info, settings, commit }: { info: BoardInfo; settings: Settings; commit: Commit }) {
  const { t } = useTranslation("light");
  return (
    <ChoiceGroup
      legend={t("settings.color")}
      groupName="color"
      value={settings.color}
      onChange={(color) => void commit({ color })}
      layout="grid-cols-2 sm:grid-cols-4"
      options={info.colors.map((color) => ({
        value: color,
        name: colorLabel(color),
        label: (
          <span className="flex items-center gap-2">
            <Swatch color={color} />
            {colorLabel(color)}
          </span>
        ),
      }))}
    />
  );
}

/** Why a color box cannot change now, or null: the last colors cannot be unticked, nor a color added past the limit. */
export function colorsLimit(colors: readonly string[], color: string): Message | null {
  const { min, max } = LIMITS.colors;
  if (colors.includes(color)) return colors.length <= min ? message("light:settings.colorsAtLeast", { min }) : null;
  return colors.length >= max ? message("light:settings.colorsAtMost", { max }) : null;
}

/** Two to four colors for Color change, in the order they are picked. */
function ColorsChoice({ info, settings, commit }: { info: BoardInfo; settings: Settings; commit: Commit }) {
  const { t } = useTranslation("light");
  const { colors } = settings;
  const [refused, setRefused] = useState<Message | null>(null);
  const hintId = useId();
  const toggle = (color: string): void => {
    const limit = colorsLimit(colors, color);
    setRefused(limit);
    if (limit !== null) return;
    void commit({ colors: colors.includes(color) ? colors.filter((name) => name !== color) : [...colors, color] });
  };
  return (
    <fieldset className="min-w-0" aria-describedby={hintId}>
      <legend className="mb-1 text-base font-medium">{t("settings.colors")}</legend>
      <p id={hintId} className="mb-2 text-sm text-muted-foreground">
        {t("settings.colorsHint", { min: LIMITS.colors.min, max: LIMITS.colors.max })}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {info.colors.map((color) => {
          const position = colors.indexOf(color);
          const chosen = position >= 0;
          return (
            <label key={color} className="relative block cursor-pointer">
              <input
                type="checkbox"
                checked={chosen}
                onChange={() => toggle(color)}
                aria-disabled={colorsLimit(colors, color) !== null || undefined}
                aria-label={
                  chosen
                    ? t("settings.colorNumbered", { color: colorLabel(color), number: position + 1 })
                    : colorLabel(color)
                }
                className="peer sr-only"
              />
              <span
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-base transition-colors",
                  "peer-checked:border-primary peer-checked:bg-accent peer-checked:text-accent-foreground peer-checked:ring-2 peer-checked:ring-primary",
                  "peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                )}
              >
                <Swatch color={color} />
                <span className="grow">{colorLabel(color)}</span>
                {chosen ? (
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {position + 1}
                  </span>
                ) : (
                  <Check aria-hidden className="size-5 opacity-0" />
                )}
              </span>
            </label>
          );
        })}
      </div>
      <div role="status">{refused && <p className="mt-2 text-sm">{translate(refused)}</p>}</div>
    </fieldset>
  );
}

function PaletteChoice({ info, settings, commit }: { info: BoardInfo; settings: Settings; commit: Commit }) {
  const { t } = useTranslation("light");
  return (
    <ChoiceGroup
      legend={t("settings.palette")}
      groupName="palette"
      value={settings.color_set}
      onChange={(color_set) => void commit({ color_set })}
      options={info.color_sets.map((set) => ({
        value: set,
        label: colorSetLabel(set),
        hint: own(COLOR_SET_COLORS, set)?.map(colorLabel).join(t("settings.paletteSeparator")),
      }))}
    />
  );
}

/** The pattern of Guided breathing, from the patterns the board lists. */
function PatternChoice({ patterns, settings, commit }: { patterns: string[]; settings: Settings; commit: Commit }) {
  const { t } = useTranslation("light");
  return (
    <ChoiceGroup
      legend={t("settings.pattern")}
      groupName="breath-pattern"
      value={settings.breath_pattern ?? null}
      onChange={(breath_pattern) => void commit({ breath_pattern })}
      options={patterns.map((pattern) => ({
        value: pattern,
        label: patternLabel(pattern),
        hint: patternHint(pattern),
      }))}
    />
  );
}

/** The settings the selected effect reads, and no others: the ones the board names, or the app's own list. */
export function EffectSettings({
  info,
  settings,
  commit,
  disabled,
}: {
  info: BoardInfo;
  settings: Settings;
  commit: Commit;
  disabled?: boolean;
}) {
  const { t } = useTranslation("light");
  const effect = effectControls(settings.effect, info);
  const control = (param: ParamName) => {
    switch (param) {
      case "color":
        return <ColorChoice info={info} settings={settings} commit={commit} />;
      case "colors":
        return <ColorsChoice info={info} settings={settings} commit={commit} />;
      case "color_set":
        return <PaletteChoice info={info} settings={settings} commit={commit} />;
      case "hold_seconds":
        return (
          <SettingSlider
            label={t("settings.hold")}
            value={settings.hold_seconds}
            {...LIMITS.hold_seconds}
            format={formatHold}
            disabled={disabled}
            onCommit={(hold_seconds) => commit({ hold_seconds })}
          />
        );
      case "period_seconds":
        return (
          <SettingSlider
            label={t("settings.period")}
            value={settings.period_seconds}
            {...LIMITS.period_seconds}
            format={formatWholeSeconds}
            disabled={disabled}
            onCommit={(period_seconds) => commit({ period_seconds })}
          />
        );
      case "breath_pattern":
        return <PatternChoice patterns={info.breath_patterns ?? []} settings={settings} commit={commit} />;
      case "floor":
        return (
          <SettingSlider
            label={t("settings.floor")}
            value={settings.floor}
            {...LIMITS.floor}
            format={formatPercent}
            disabled={disabled}
            onCommit={(floor) => commit({ floor })}
          />
        );
      case "twinkle_strength":
        return (
          <SettingSlider
            label={t("settings.twinkle")}
            value={settings.twinkle_strength}
            {...LIMITS.twinkle_strength}
            format={formatPercent}
            disabled={disabled}
            onCommit={(twinkle_strength) => commit({ twinkle_strength })}
          />
        );
    }
  };
  return (
    <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4" data-testid="effect-settings">
      {settings.effect === "fall_asleep" && settings.timer_minutes === 0 && (
        <Banner tone="info">{t("settings.fallAsleep")}</Banner>
      )}
      {effect.params.map((param) => (
        <div key={param}>{control(param)}</div>
      ))}
      {effect.newer && (
        <p className="text-base text-muted-foreground" data-testid="newer-effect">
          {t("settings.newerEffect")}
        </p>
      )}
    </div>
  );
}
