// SPDX-License-Identifier: GPL-3.0-or-later

import { LIMITS, type Settings } from "../../light/model";
import { cn } from "../../lib/utils";
import { useBoard } from "../board-context";
import { Banner } from "../components/banner";
import { Card, CardTitle } from "../components/card";
import { EffectPicker } from "../light/effect-picker";
import { EffectSettings } from "../light/effect-settings";
import { LiveCard } from "../light/live-card";
import { PowerButton } from "../light/power-button";
import { SettingSlider } from "../light/setting-slider";
import { TimerCard } from "../light/timer-card";
import { useCommit } from "../light/use-commit";

export function LightView() {
  const { board, session } = useBoard();
  const { pending, commit } = useCommit();
  const lost = board.phase === "lost";
  const { info, light } = board;
  if (!info || !board.settings || !light) return null;
  const settings: Settings = { ...board.settings, ...pending };
  return (
    <fieldset disabled={lost} className={cn("m-0 flex min-w-0 flex-col gap-4 border-0 p-0", lost && "opacity-60")}>
      <legend className="sr-only">Light</legend>
      {lost && (
        <Banner tone="warning">
          {board.auto === "restarting"
            ? "Zenit is restarting. It connects again by itself in a few seconds."
            : board.auto === "reconnecting"
              ? "Connecting to Zenit again..."
              : "Connection lost. These are the last values Zenit reported. Reconnect to change the light."}
        </Banner>
      )}
      <Card className="flex flex-col items-center gap-4">
        <PowerButton on={light.on} disabled={lost} onToggle={(on) => void session.setPower(on)} />
        {board.kind === "usb" && (
          <Banner tone="info">
            Connected by USB. The light gets no power from USB: plug in the panel power socket and use WiFi to see it.
          </Banner>
        )}
      </Card>
      <Card aria-labelledby="brightness-title">
        <h2 id="brightness-title" className="sr-only">
          Brightness
        </h2>
        <SettingSlider
          label="Brightness"
          value={settings.brightness}
          {...LIMITS.brightness}
          format={(value) => `${value} %`}
          disabled={lost}
          onCommit={(brightness) => commit({ brightness })}
        />
      </Card>
      <Card aria-labelledby="effect-title">
        <CardTitle id="effect-title">Effect</CardTitle>
        <EffectPicker effects={info.effects} value={settings.effect} onChange={(effect) => void commit({ effect })} />
        <EffectSettings info={info} settings={settings} commit={commit} disabled={lost} />
      </Card>
      <TimerCard
        minutes={settings.timer_minutes}
        light={light}
        onChange={(timer_minutes) => commit({ timer_minutes })}
      />
      <LiveCard light={light} />
    </fieldset>
  );
}
