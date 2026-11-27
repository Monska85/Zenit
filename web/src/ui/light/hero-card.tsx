// SPDX-License-Identifier: GPL-3.0-or-later

import { LIMITS, liveLine } from "../../light/model";
import type { LightStatus } from "../../protocol/types";
import { Banner } from "../components/banner";
import { Card } from "../components/card";
import { PowerButton } from "./power-button";
import { SettingSlider } from "./setting-slider";

/**
 * The first card of the Light view: the power button, what the light does now in one line (as the board reports it
 * each second), and the brightness. The line is not a live region: in Color change it moves every few seconds.
 */
export function HeroCard({
  light,
  brightness,
  usb,
  disabled,
  onPower,
  onBrightness,
}: {
  light: LightStatus;
  brightness: number;
  usb: boolean;
  disabled: boolean;
  onPower: (on: boolean) => void;
  onBrightness: (brightness: number) => Promise<void>;
}) {
  const line = liveLine(light);
  const reduced = light.power_scale < 100;
  return (
    <Card aria-labelledby="hero-title" className="flex flex-col gap-4">
      <h2 id="hero-title" className="sr-only">
        Light now
      </h2>
      <div className="flex items-center gap-4">
        <PowerButton on={light.on} color={light.color} disabled={disabled} onToggle={onPower} />
        <div className="min-w-0 grow">
          <p className="text-lg font-medium" data-testid="live-state">
            {line === null ? (
              "Off"
            ) : (
              <>
                <span data-testid="live-color">{line.color}</span>
                {" · "}
                <span data-testid="live-effect">{line.effect}</span>
                {line.timer !== null && (
                  <>
                    {" · "}
                    <span className="font-normal text-muted-foreground">{line.timer}</span>
                  </>
                )}
              </>
            )}
          </p>
          {reduced && (
            <p role="status" className="mt-1 text-base text-muted-foreground">
              Light reduced to {light.power_scale} % to stay cool.
            </p>
          )}
        </div>
      </div>
      <SettingSlider
        label="Brightness"
        value={brightness}
        {...LIMITS.brightness}
        format={(value) => `${value} %`}
        disabled={disabled}
        onCommit={onBrightness}
      />
      {usb && (
        <Banner tone="info">
          Connected by USB. The light gets no power from USB: plug in the panel power socket and use WiFi to see it.
        </Banner>
      )}
    </Card>
  );
}
