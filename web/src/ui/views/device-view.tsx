// SPDX-License-Identifier: GPL-3.0-or-later

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { boardName } from "../../board/session";
import { firmwareSummary } from "../../device/update";
import { formatList, formatNumber } from "../../i18n";
import { colorLabel, colorSetLabel, effectInfo } from "../../light/model";
import { useBoard } from "../board-context";
import { Banner } from "../components/banner";
import { Card, CardTitle } from "../components/card";
import { FirmwareCard, publishedState, usePublishedFirmware, type Published } from "../device/firmware-card";
import { MaintenanceCard } from "../device/maintenance-card";
import { AccessCard, hasAdvancedSettings, TimeCard, UpdateSettingsCard } from "../device/settings-cards";
import { TimeZoneOffer } from "../device/time-zone";
import { WebAppCard } from "../device/web-app-card";
import { WifiCard } from "../device/wifi-card";
import type { Route } from "../route";

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
  const { t } = useTranslation("device");
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
    ...(name !== null ? [[t("board.name"), name] as [string, string]] : []),
    [t("board.connection"), board.kind === "usb" ? t("board.usbCable") : board.label],
    [
      t("board.firmware"),
      summary === null ? info.firmware : t("board.firmwareWithSummary", { version: info.firmware, summary }),
    ],
  ];
  // Watts with up to two decimals and no grouping
  const watts = (milliwatts: number): string =>
    t("details.watts", {
      value: formatNumber(Number((milliwatts / 1000).toFixed(2)), { maximumFractionDigits: 2, useGrouping: false }),
    });
  return (
    <Card aria-labelledby="device-title">
      <CardTitle id="device-title">{t("board.title")}</CardTitle>
      <Rows rows={rows} />
      <details className="mt-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-base font-medium">
          {t("details.title")}
        </summary>
        <div className="mt-1" data-testid="technician-details">
          <Rows
            rows={[
              [t("details.hardware"), info.board],
              [t("details.powerLimit"), watts(info.power_limit_mw)],
              [t("details.colors"), formatList(info.colors.map(colorLabel))],
              [t("details.effects"), formatList(info.effects.map((effect) => effectInfo(effect).label))],
              [t("details.palettes"), formatList(info.color_sets.map(colorSetLabel))],
              [t("details.protocol"), String(info.protocol)],
              [
                t("details.freeMemory"),
                info.memory.free === 0
                  ? t("details.notReported")
                  : t("details.bytes", { value: formatNumber(info.memory.free) }),
              ],
              [
                t("details.settingsMemory"),
                info.nvs.used === 0 && info.nvs.free === 0
                  ? t("details.notReported")
                  : t("details.usedFree", { used: info.nvs.used, free: info.nvs.free }),
              ],
            ]}
          />
        </div>
      </details>
    </Card>
  );
}

/** The settings most people never change, folded: how Zenit updates itself, and its clock. Open while the page is. */
function Advanced({
  open,
  onToggle,
  chosen,
  onChoose,
}: {
  open: boolean;
  onToggle: (open: boolean) => void;
  chosen: string | null;
  onChoose: (name: string) => void;
}) {
  const { t } = useTranslation("device");
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
          <span className="block text-lg font-semibold">{t("advanced.title")}</span>
          <span className="block text-sm text-muted-foreground">{t("advanced.subtitle")}</span>
        </span>
        <ChevronDown aria-hidden className="size-5 shrink-0 motion-safe:transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-4 flex flex-col gap-4">
        <UpdateSettingsCard />
        <TimeCard chosen={chosen} onChoose={onChoose} />
      </div>
    </details>
  );
}

export function DeviceView({ go }: { go: (route: Route) => void }) {
  const { t } = useTranslation("device");
  const { board } = useBoard();
  const served = board.served !== null;
  const published = usePublishedFirmware(!served);
  const [advanced, setAdvanced] = useState(false);
  // The time zone chosen on this page, which names the board's POSIX string while it is still that zone's
  const [zone, setZone] = useState<string | null>(null);
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("view.title")}</h1>
      <TimeZoneOffer chosen={zone} onChoose={setZone} />
      {board.info ? (
        <BoardCard published={published} />
      ) : (
        <Banner tone="info">
          <p>{t("view.connectFirst")}</p>
          <a className="inline-flex min-h-11 items-center font-medium text-primary underline" href="#/connect">
            {t("view.connect")}
          </a>
        </Banner>
      )}
      <WifiCard />
      <FirmwareCard published={published} />
      <WebAppCard />
      <Advanced open={advanced} onToggle={setAdvanced} chosen={zone} onChoose={setZone} />
      <AccessCard />
      <MaintenanceCard published={published === "missing" ? null : published} go={go} />
    </>
  );
}
