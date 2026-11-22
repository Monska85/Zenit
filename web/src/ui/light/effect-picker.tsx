// SPDX-License-Identifier: GPL-3.0-or-later

import { effectInfo } from "../../light/model";
import { ChoiceGroup } from "../components/choice";

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
          label: <span className="font-semibold">{info.label}</span>,
          name: info.label,
          hint: info.description,
        };
      })}
    />
  );
}
