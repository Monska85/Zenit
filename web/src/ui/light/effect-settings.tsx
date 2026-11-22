// SPDX-License-Identifier: GPL-3.0-or-later

import { Check } from "lucide-react";
import {
  COLOR_SET_COLORS,
  COLOR_SWATCHES,
  LIMITS,
  colorLabel,
  colorSetLabel,
  effectInfo,
  formatHold,
  type ParamName,
  type Settings,
} from "../../light/model";
import type { BoardInfo } from "../../protocol/types";
import { Banner } from "../components/banner";
import { ChoiceGroup } from "../components/choice";
import { cn } from "../../lib/utils";
import { SettingSlider } from "./setting-slider";

type Commit = (patch: Partial<Settings>) => Promise<void>;

const percent = (value: number): string => `${value} %`;
const seconds = (value: number): string => `${value} s`;

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-6 shrink-0 rounded-full border border-black/20"
      style={{ background: COLOR_SWATCHES[color] ?? "var(--muted)" }}
    />
  );
}

function ColorChoice({ info, settings, commit }: { info: BoardInfo; settings: Settings; commit: Commit }) {
  return (
    <ChoiceGroup
      legend="Color"
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

/** Two to four colors for Color change, in the order they are picked. */
function ColorsChoice({ info, settings, commit }: { info: BoardInfo; settings: Settings; commit: Commit }) {
  const { colors } = settings;
  const toggle = (color: string): void => {
    const next = colors.includes(color) ? colors.filter((name) => name !== color) : [...colors, color];
    if (next.length >= LIMITS.colors.min && next.length <= LIMITS.colors.max) void commit({ colors: next });
  };
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-base font-medium">Colors</legend>
      <p className="mb-2 text-sm text-muted-foreground">
        Pick {LIMITS.colors.min} to {LIMITS.colors.max}. They show in the order you pick them.
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
                aria-label={chosen ? `${colorLabel(color)}, number ${position + 1}` : colorLabel(color)}
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
    </fieldset>
  );
}

function PaletteChoice({ info, settings, commit }: { info: BoardInfo; settings: Settings; commit: Commit }) {
  return (
    <ChoiceGroup
      legend="Palette"
      groupName="palette"
      value={settings.color_set}
      onChange={(color_set) => void commit({ color_set })}
      options={info.color_sets.map((set) => ({
        value: set,
        label: colorSetLabel(set),
        hint: COLOR_SET_COLORS[set]?.map(colorLabel).join(", "),
      }))}
    />
  );
}

/** The settings the selected effect reads, and no others. */
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
  const effect = effectInfo(settings.effect);
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
            label="Time on each color"
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
            label="Length of a breath"
            value={settings.period_seconds}
            {...LIMITS.period_seconds}
            format={seconds}
            disabled={disabled}
            onCommit={(period_seconds) => commit({ period_seconds })}
          />
        );
      case "floor":
        return (
          <SettingSlider
            label="Dimmest level"
            value={settings.floor}
            {...LIMITS.floor}
            format={percent}
            disabled={disabled}
            onCommit={(floor) => commit({ floor })}
          />
        );
      case "twinkle_strength":
        return (
          <SettingSlider
            label="Twinkle strength"
            value={settings.twinkle_strength}
            {...LIMITS.twinkle_strength}
            format={percent}
            disabled={disabled}
            onCommit={(twinkle_strength) => commit({ twinkle_strength })}
          />
        );
    }
  };
  return (
    <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4" data-testid="effect-settings">
      {settings.effect === "fall_asleep" && settings.timer_minutes === 0 && (
        <Banner tone="info">This effect dims while the sleep timer runs. Set a sleep timer below.</Banner>
      )}
      {effect.params.map((param) => (
        <div key={param}>{control(param)}</div>
      ))}
    </div>
  );
}
