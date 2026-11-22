// SPDX-License-Identifier: GPL-3.0-or-later

import { useRef, useState } from "react";
import { LIMITS, type Settings } from "../../light/model";
import { cn } from "../../lib/utils";
import { useBoard } from "../board-context";
import { Banner } from "../components/banner";
import { Card, CardTitle } from "../components/card";
import { CommitTracker } from "../light/commit-tracker";
import { EffectPicker } from "../light/effect-picker";
import { EffectSettings } from "../light/effect-settings";
import { LiveCard } from "../light/live-card";
import { PowerButton } from "../light/power-button";
import { SettingSlider } from "../light/setting-slider";
import { TimerCard } from "../light/timer-card";

export function LightView() {
  const { board, session } = useBoard();
  // What the user chose and the board has not confirmed yet is shown at once; the board's reply replaces it
  const [pending, setPending] = useState<Partial<Settings>>({});
  const tracker = useRef(new CommitTracker());
  const lost = board.phase === "lost";
  const { info, light } = board;
  if (!info || !board.settings || !light) return null;
  const settings: Settings = { ...board.settings, ...pending };
  const commit = async (patch: Partial<Settings>): Promise<void> => {
    setPending((current) => ({ ...current, ...patch }));
    // Only the latest commit of a setting clears it: an earlier one that ends late leaves the later choice showing
    const finish = tracker.current.start(Object.keys(patch));
    try {
      await session.setSettings(patch);
    } finally {
      const done = finish();
      setPending((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !done.includes(key))));
    }
  };

  return (
    <fieldset disabled={lost} className={cn("m-0 flex min-w-0 flex-col gap-4 border-0 p-0", lost && "opacity-60")}>
      <legend className="sr-only">Light</legend>
      {lost && (
        <Banner tone="warning">
          Connection lost. These are the last values Zenit reported. Reconnect to change the light.
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
