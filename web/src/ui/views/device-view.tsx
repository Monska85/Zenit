// SPDX-License-Identifier: GPL-3.0-or-later

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { boardName } from "../../board/session";
import { firmwareSummary } from "../../device/update";
import { colorLabel, colorSetLabel, effectInfo } from "../../light/model";
import { useBoard } from "../board-context";
import { Banner } from "../components/banner";
import { Card, CardTitle } from "../components/card";
import { FirmwareCard, publishedState, usePublishedFirmware, type Published } from "../device/firmware-card";
import { MaintenanceCard } from "../device/maintenance-card";
import { AccessCard, hasAdvancedSettings, TimeCard, UpdateSettingsCard } from "../device/settings-cards";
import { WebAppCard } from "../device/web-app-card";
import { WifiCard } from "../device/wifi-card";
import type { Route } from "../route";

const watts = (milliwatts: number): string => `${Number((milliwatts / 1000).toFixed(2))} W`;

/** Rows of names and values. */
function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
      {rows.map(([name, value]) => (
        <div key={name} className="contents">
          <dt className="text-muted-foreground">{name}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** What matters first: the board's name, how it is connected, the firmware and its state. The rest is for technicians.
 */
function BoardCard({ published }: { published: Published }) {
  const { board } = useBoard();
  const { info } = board;
  if (!info) return null;
  const name = boardName(board);
  const summary = firmwareSummary(
    board.phase === "connected" ? board.update : null,
    board.settings,
    publishedState(info.firmware, published),
  );
  const rows: Array<[string, string]> = [
    ...(name !== null ? [["Name", name] as [string, string]] : []),
    ["Connection", board.kind === "usb" ? "USB cable" : board.label],
    ["Firmware", summary === null ? info.firmware : `${info.firmware} · ${summary}`],
  ];
  return (
    <Card aria-labelledby="device-title">
      <CardTitle id="device-title">Your Zenit</CardTitle>
      <Rows rows={rows} />
      <details className="mt-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-base font-medium">
          Details for technicians
        </summary>
        <div className="mt-1" data-testid="technician-details">
          <Rows
            rows={[
              ["Hardware", info.board],
              ["Light power limit", watts(info.power_limit_mw)],
              ["Colors", info.colors.map(colorLabel).join(", ")],
              ["Effects", info.effects.map((effect) => effectInfo(effect).label).join(", ")],
              ["Palettes", info.color_sets.map(colorSetLabel).join(", ")],
              ["Protocol", String(info.protocol)],
              [
                "Free memory",
                info.memory.free === 0 ? "Not reported" : `${info.memory.free.toLocaleString("en-GB")} bytes`,
              ],
              [
                "Settings memory",
                info.nvs.used === 0 && info.nvs.free === 0
                  ? "Not reported"
                  : `${info.nvs.used} used, ${info.nvs.free} free`,
              ],
            ]}
          />
        </div>
      </details>
    </Card>
  );
}

/** The settings most people never change, folded: how Zenit updates itself, and its clock. Open while the page is. */
function Advanced({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) {
  const { board } = useBoard();
  if (board.phase !== "connected" || !hasAdvancedSettings(board.settings)) return null;
  return (
    <details
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
      className="group flex flex-col"
      data-testid="advanced"
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-2 sm:px-5 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-lg font-semibold">Advanced settings</span>
          <span className="block text-sm text-muted-foreground">Updates and time</span>
        </span>
        <ChevronDown aria-hidden className="size-5 shrink-0 motion-safe:transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-4 flex flex-col gap-4">
        <UpdateSettingsCard />
        <TimeCard />
      </div>
    </details>
  );
}

export function DeviceView({ go }: { go: (route: Route) => void }) {
  const { board } = useBoard();
  const served = board.served !== null;
  const published = usePublishedFirmware(!served);
  const [advanced, setAdvanced] = useState(false);
  return (
    <>
      <h1 className="text-2xl font-semibold">Device</h1>
      {board.info ? (
        <BoardCard published={published} />
      ) : (
        <Banner tone="info">
          <p>Connect to see your Zenit.</p>
          <a className="inline-flex min-h-11 items-center font-medium text-primary underline" href="#/connect">
            Connect
          </a>
        </Banner>
      )}
      <WifiCard />
      <FirmwareCard published={published} />
      <WebAppCard />
      <Advanced open={advanced} onToggle={setAdvanced} />
      <AccessCard />
      <MaintenanceCard published={published === "missing" ? null : published} go={go} />
    </>
  );
}
