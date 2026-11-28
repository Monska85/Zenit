// SPDX-License-Identifier: GPL-3.0-or-later

import { own } from "../../lib/own";
import { COLOR_SWATCHES, effectInfo } from "../../light/model";
import { cn } from "../../lib/utils";
import { ChoiceGroup } from "../components/choice";

/**
 * How each effect's small preview moves (keyframes in index.css). The animation runs only when the person allows motion:
 * with reduced motion every preview is a still dot. An effect the app does not know gets a still, neutral dot. Like the
 * light itself, no preview shows more than 3 changes a second.
 */
const PREVIEWS: Record<string, string> = {
  static: "",
  color_change: "motion-safe:animate-[preview-cycle_6s_linear_infinite]",
  breathing: "motion-safe:animate-[preview-breathe_4s_ease-in-out_infinite]",
  twinkle: "motion-safe:animate-[preview-twinkle_1.8s_linear_infinite]",
  fall_asleep: "motion-safe:animate-[preview-dim_5s_ease-in_infinite]",
  christmas: "motion-safe:animate-[preview-christmas_3s_steps(1,end)_infinite]",
  shooting_star: "motion-safe:animate-[preview-shooting-star_5s_linear_infinite]",
  guided_breathing: "motion-safe:animate-[preview-guided_8s_ease-in-out_infinite]",
  jingle: "motion-safe:animate-[preview-jingle_2.4s_ease-out_infinite]",
  hop: "motion-safe:animate-[preview-hop_2.1s_steps(1,end)_infinite]",
};

const PREVIEW_COLORS: Record<string, string> = {
  color_change: COLOR_SWATCHES["red"] ?? "",
  christmas: COLOR_SWATCHES["red"] ?? "",
  jingle: COLOR_SWATCHES["red"] ?? "",
  hop: COLOR_SWATCHES["red"] ?? "",
};

function Preview({ effect }: { effect: string }) {
  const motion = own(PREVIEWS, effect);
  return (
    <span
      aria-hidden
      data-testid="effect-preview"
      className={cn(
        "inline-block size-5 shrink-0 rounded-full border border-black/20",
        motion === undefined && "bg-muted",
        motion,
      )}
      style={motion === undefined ? undefined : { background: own(PREVIEW_COLORS, effect) ?? COLOR_SWATCHES["white"] }}
    />
  );
}

/** One card per effect the board lists, in the board's order. */
export function EffectPicker({
  effects,
  value,
  onChange,
}: {
  effects: string[];
  value: string;
  onChange: (effect: string) => void;
}) {
  return (
    <ChoiceGroup
      legend="Effect"
      hideLegend
      groupName="effect"
      value={value}
      onChange={onChange}
      layout="grid-cols-2"
      options={effects.map((name) => {
        const info = effectInfo(name);
        return {
          value: name,
          label: (
            <span className="flex items-center gap-2 font-semibold">
              <Preview effect={name} />
              {info.label}
            </span>
          ),
          name: info.label,
          hint: info.description,
        };
      })}
    />
  );
}
