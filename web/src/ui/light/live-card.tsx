// SPDX-License-Identifier: GPL-3.0-or-later

import { own } from "../../lib/own";
import { COLOR_SWATCHES, colorLabel, effectInfo } from "../../light/model";
import type { LightStatus } from "../../protocol/types";
import { Card, CardTitle } from "../components/card";

/** What the light is doing now, as the board reports it each second. */
export function LiveCard({ light }: { light: LightStatus }) {
  const reduced = light.power_scale < 100;
  return (
    <Card aria-labelledby="live-title">
      <CardTitle id="live-title">Right now</CardTitle>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-base">
        <dt className="text-muted-foreground">Light</dt>
        <dd className="flex items-center gap-2" data-testid="live-color">
          {light.color === null ? (
            "Off"
          ) : (
            <>
              <span
                aria-hidden
                className="inline-block size-6 rounded-full border border-black/20"
                style={{ background: own(COLOR_SWATCHES, light.color) ?? "var(--muted)" }}
              />
              {colorLabel(light.color)}
            </>
          )}
        </dd>
        <dt className="text-muted-foreground">Effect</dt>
        <dd data-testid="live-effect">{effectInfo(light.effect).label}</dd>
      </dl>
      {reduced && (
        <p role="status" className="mt-3 text-base">
          Light reduced to {light.power_scale} % to stay cool.
        </p>
      )}
    </Card>
  );
}
