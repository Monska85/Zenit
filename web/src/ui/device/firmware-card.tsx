// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { dateLocale } from "../../i18n";
import {
  boardVerdict,
  canCheck,
  describeResult,
  describeUpdateState,
  firmwareUpdatesOn,
  formatCheckTime,
  installAction,
  firmwareStateSource,
  updateBusy,
  updatesOn,
  webUpdatesOn,
} from "../../device/update";
import { firmwareState, readManifest, type FirmwareManifest, type FirmwareState } from "../../release/manifest";
import { useBoard, useSession } from "../board-context";
import { Banner } from "../components/banner";
import { Button } from "../components/button";
import { Card, CardTitle } from "../components/card";
import { ConfirmDialog } from "../components/confirm-dialog";

/** The firmware published next to the app: null while it loads, "missing" when there is none (local build, offline). */
export type Published = FirmwareManifest | null | "missing";

/** Reads the firmware published next to the app. A page served by a board has none (`enabled` false). */
export function usePublishedFirmware(enabled: boolean): Published {
  const [manifest, setManifest] = useState<Published>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch(new URL("firmware/manifest.json", document.baseURI), { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => setManifest(readManifest(value) ?? "missing"))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setManifest("missing");
      });
    return () => controller.abort();
  }, [enabled]);
  return enabled ? manifest : "missing";
}

/** How the board's firmware compares with the published one, or null when either is unknown. */
export function publishedState(running: string | undefined, published: Published): FirmwareState | null {
  return running !== undefined && published !== null && published !== "missing"
    ? firmwareState(running, published.version)
    : null;
}

function InstallDialog({
  version,
  force,
  open,
  onOpenChange,
}: {
  version: string;
  force: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("device");
  const session = useSession();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={force ? t("firmware.install.titleAnyway", { version }) : t("firmware.install.title", { version })}
      confirm={force ? t("firmware.install.confirmAnyway") : t("firmware.install.confirm")}
      tone={force ? "danger" : "default"}
      onConfirm={() => void session.installUpdate(force)}
    >
      {force && <Banner tone="warning">{t("firmware.install.warning")}</Banner>}
      <p>{t("firmware.install.text")}</p>
    </ConfirmDialog>
  );
}

/** What the board reports about firmware updates, and the two things to ask of it: look now, and install. */
function BoardUpdates({ newerSince }: { newerSince: boolean }) {
  const { t } = useTranslation("device");
  const { board, session } = useBoard();
  const [asking, setAsking] = useState(false);
  const { update, wifi } = board;
  if (!update) return null;
  const action = installAction(update, wifi, board.settings);
  const progressText = describeUpdateState(update);
  // The progress line is read out when the state changes, not at every percent: the bar carries the number
  const progressWords = describeUpdateState({ ...update, progress: null });
  const checked = formatCheckTime(update.last_check, dateLocale(navigator.languages));
  const found = update.available;
  return (
    <>
      {!updatesOn(update) ? (
        <p className="mt-3 text-base" data-testid="update-off">
          {t("firmware.updatesOff")}
        </p>
      ) : !firmwareUpdatesOn(update, board.settings) ? (
        <p className="mt-3 text-base" data-testid="update-off">
          {t("firmware.firmwareUpdatesOff")}
        </p>
      ) : (
        <>
          <p className="mt-3 text-base font-medium" data-testid="update-result">
            {newerSince
              ? t("firmware.newerSince")
              : found !== null && update.last_result === "available"
                ? t("firmware.versionAvailable", { version: found })
                : describeResult(update.last_result)}
          </p>
          {checked && (
            <p className="mt-1 text-sm text-muted-foreground" data-testid="update-checked">
              {t("firmware.lastChecked", { time: checked })}
            </p>
          )}
        </>
      )}
      {progressText && (
        <div className="mt-3" data-testid="update-progress">
          <p role="status" className="text-base font-medium">
            <span aria-hidden>{progressText}</span>
            <span className="sr-only">{progressWords}</span>
          </p>
          {update.state === "downloading" && (
            <div
              role="progressbar"
              aria-label={t("firmware.downloadProgress")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={update.progress ?? undefined}
              className="mt-2 h-3 overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full bg-primary" style={{ width: `${update.progress ?? 0}%` }} />
            </div>
          )}
        </div>
      )}
      {update.trial && <p className="mt-3 text-base text-muted-foreground">{t("firmware.trial")}</p>}
      {update.rolled_back !== null && (
        <Banner tone="warning" className="mt-3">
          {t("firmware.rolledBack", { version: update.rolled_back })}
        </Banner>
      )}
      {update.skipped !== null && (
        <p className="mt-3 text-base text-muted-foreground">{t("firmware.skipped", { version: update.skipped })}</p>
      )}
      {firmwareUpdatesOn(update, board.settings) && wifi !== null && wifi.state !== "connected" && (
        <p className="mt-3 text-base text-muted-foreground">{t("firmware.needsWifi")}</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!canCheck(update, wifi, webUpdatesOn(board.settings), board.settings)}
          onClick={() => void session.checkUpdate()}
        >
          {t("firmware.checkNow")}
        </Button>
        {action !== "none" && found !== null && (
          <Button
            variant={action === "force" ? "danger" : "default"}
            disabled={updateBusy(update)}
            onClick={() => setAsking(true)}
          >
            {action === "force"
              ? t("firmware.installAnywayButton", { version: found })
              : t("firmware.installButton", { version: found })}
          </Button>
        )}
      </div>
      {found !== null && (
        <InstallDialog version={found} force={action === "force"} open={asking} onOpenChange={setAsking} />
      )}
    </>
  );
}

/**
 * The one Firmware card: the version on the board, the latest published one, and then the board's own check with its
 * actions. The comparison with the published firmware is said when the board's check has no verdict (an older firmware
 * with no check, no connection, never checked, failed, updates off); when the board says up to date and the published
 * version is newer, one sentence says so in place of both. An available update is said once.
 */
export function FirmwareCard({ published }: { published: Published }) {
  const { t } = useTranslation("device");
  const { board } = useBoard();
  const running = board.info?.firmware;
  const ownCheck = board.update !== null && board.phase === "connected";
  const source = firmwareStateSource(
    ownCheck ? board.update : null,
    board.settings,
    publishedState(running, published),
  );
  // The board says up to date while the published version is newer: one sentence says so, in place of both
  const newerSince =
    ownCheck &&
    source?.from === "published" &&
    board.update !== null &&
    boardVerdict(board.update, board.settings) === "up_to_date";
  const state = source?.from === "published" && !newerSince ? source.state : null;
  return (
    <Card aria-labelledby="firmware-title">
      <CardTitle id="firmware-title">{t("firmware.title")}</CardTitle>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
        {running !== undefined && (
          <>
            <dt className="text-muted-foreground">{t("firmware.running")}</dt>
            <dd data-testid="firmware-running">{running}</dd>
          </>
        )}
        {!board.served && (
          <>
            <dt className="text-muted-foreground">{t("firmware.latestPublished")}</dt>
            <dd data-testid="firmware-published">
              {published === null
                ? t("firmware.checking")
                : published === "missing"
                  ? t("firmware.notAvailable")
                  : published.version}
            </dd>
          </>
        )}
      </dl>
      {state && (
        <p role="status" className="mt-3 text-base font-medium" data-testid="firmware-state">
          {t(`firmware.state.${state}`)}
        </p>
      )}
      {published === "missing" && !board.served && (
        <p className="mt-3 text-base text-muted-foreground">{t("firmware.publishedMissing")}</p>
      )}
      {ownCheck && <BoardUpdates newerSince={newerSince} />}
    </Card>
  );
}
