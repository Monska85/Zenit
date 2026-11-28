// SPDX-License-Identifier: GPL-3.0-or-later

import { useTranslation } from "react-i18next";
import type { Settings } from "../../light/model";
import { cn } from "../../lib/utils";
import { useBoard } from "../board-context";
import { Card, CardTitle } from "../components/card";
import { EffectPicker } from "../light/effect-picker";
import { FavoritesCard } from "../light/favorites-card";
import { EffectSettings } from "../light/effect-settings";
import { HeroCard } from "../light/hero-card";
import { TimerCard } from "../light/timer-card";
import { useCommit } from "../light/use-commit";

/** A lost connection keeps the last values here, greyed; the shell's banner says so and holds Reconnect. */
export function LightView() {
  const { t } = useTranslation("light");
  const { board, session } = useBoard();
  const { pending, commit } = useCommit();
  const lost = board.phase === "lost";
  const { info, light } = board;
  if (!info || !board.settings || !light) return null;
  const settings: Settings = { ...board.settings, ...pending };
  return (
    <fieldset disabled={lost} className={cn("m-0 flex min-w-0 flex-col gap-4 border-0 p-0", lost && "opacity-60")}>
      <legend className="sr-only">{t("view.legend")}</legend>
      <HeroCard
        light={light}
        brightness={settings.brightness}
        usb={board.kind === "usb"}
        disabled={lost}
        onPower={(on) => void session.setPower(on)}
        onBrightness={(brightness) => commit({ brightness })}
      />
      {info.limits.favorites !== undefined && board.favorites !== null && (
        <FavoritesCard
          info={info}
          settings={settings}
          light={light}
          favorites={board.favorites}
          start={board.start}
          disabled={lost}
        />
      )}
      <Card aria-labelledby="effect-title">
        <CardTitle id="effect-title">{t("view.effectTitle")}</CardTitle>
        <EffectPicker effects={info.effects} value={settings.effect} onChange={(effect) => void commit({ effect })} />
        <EffectSettings info={info} settings={settings} commit={commit} disabled={lost} />
      </Card>
      <TimerCard
        minutes={settings.timer_minutes}
        light={light}
        onChange={(timer_minutes) => commit({ timer_minutes })}
      />
    </fieldset>
  );
}
