// SPDX-License-Identifier: GPL-3.0-or-later

// What the firmware card says about `status.update` (docs/board/wifi-and-updates-v1.md#status), in plain words.

import { i18n } from "../i18n";
import type { FirmwareState } from "../release/manifest";
import type { Settings, UpdateStatus, WebAppStatus, WifiStatus } from "../protocol/types";

/** Whether the board looks for new versions of the web app: the mode is not off and `update_web` is not false. */
export const webUpdatesOn = (settings: Settings | null): boolean =>
  settings !== null && settings.update_mode !== "off" && settings.update_web !== false;

/** The `last_result` values with a sentence in the catalog (`firmware.results`). */
const RESULTS = [
  "never",
  "up_to_date",
  "available",
  "skipped",
  "installed",
  "no_network",
  "no_time",
  "unreachable",
  "not_published",
  "tls_error",
  "bad_manifest",
  "bad_download",
  "flash_error",
] as const;

/** Whether `word` is one of `words`: a list, so a word like `constructor` never reaches a prototype. */
const among = <T extends string>(words: readonly T[], word: string): word is T =>
  (words as readonly string[]).includes(word);

export function describeResult(result: string): string {
  return among(RESULTS, result)
    ? i18n.t(`device:firmware.results.${result}`)
    : i18n.t("device:firmware.unknownResult", { result });
}

/** What the board is doing now, or null when it is idle. */
export function describeUpdateState(update: UpdateStatus): string | null {
  switch (update.state) {
    case "idle":
      return null;
    case "checking":
      return i18n.t("device:firmware.progress.checking");
    case "downloading": {
      const web = update.target === "web";
      if (update.progress === null)
        return web ? i18n.t("device:firmware.progress.downloadingApp") : i18n.t("device:firmware.progress.downloading");
      const values = { progress: update.progress };
      return web
        ? i18n.t("device:firmware.progress.downloadingAppPercent", values)
        : i18n.t("device:firmware.progress.downloadingPercent", values);
    }
    case "verifying":
      return i18n.t("device:firmware.progress.verifying");
    case "restarting":
      return i18n.t("device:firmware.progress.restarting");
    default:
      return i18n.t("device:firmware.progress.unknown", { state: update.state });
  }
}

/** Whether the board is installing new firmware now: not a check, not a download of the web app. */
export const firmwareBusy = (update: UpdateStatus): boolean =>
  updateBusy(update) && update.state !== "checking" && update.target !== "web";

/** Whether the board is busy with an update: nothing else may be asked of it. */
export const updateBusy = (update: UpdateStatus): boolean => update.state !== "idle";

/** Whether this firmware or the last checks leave the update choices open at all. */
export const updatesOn = (update: UpdateStatus): boolean => update.mode !== "off";

/** Whether the board looks for and installs new firmware: updates on and `update_firmware` not false. */
export const firmwareUpdatesOn = (update: UpdateStatus, settings: Settings | null): boolean =>
  updatesOn(update) && settings?.update_firmware !== false;

export type UpdateAction = "none" | "install" | "force";

/**
 * Which install button the card offers: the normal one for a version that is available, "Install anyway" for the version
 * on the skip list, none otherwise (nothing found, a board on trial, a check or an install running).
 */
export function installAction(
  update: UpdateStatus,
  wifi: WifiStatus | null,
  settings: Settings | null = null,
): UpdateAction {
  if (!firmwareUpdatesOn(update, settings) || updateBusy(update) || update.available === null || update.trial)
    return "none";
  if (wifi !== null && wifi.state !== "connected") return "none";
  if (update.last_result === "available") return "install";
  if (update.last_result === "skipped") return "force";
  return "none";
}

/**
 * Whether "Check now" works: updates on, nothing running, connected. With the firmware's updates off (the mode, or
 * `update_firmware` false), a check still looks for a new app when `webUpdatesOn`.
 */
export function canCheck(
  update: UpdateStatus,
  wifi: WifiStatus | null,
  webUpdatesOn = false,
  settings: Settings | null = null,
): boolean {
  const on = firmwareUpdatesOn(update, settings) || (webUpdatesOn && update.web !== undefined);
  return on && !updateBusy(update) && (wifi === null || wifi.state === "connected");
}

/** When the last check ended, in the reader's local time, or null. */
export function formatCheckTime(unixSeconds: number | null, locale?: string): string | null {
  if (unixSeconds === null) return null;
  return new Date(unixSeconds * 1000).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/** The states of the web app in the board's own partition with a sentence in the catalog (`webApp.states`). */
const WEB_STATES = ["ok", "installing", "missing", "incompatible"] as const;

/** The `last_result` values of the web app with a sentence in the catalog (`webApp.results`). */
const WEB_RESULTS = [
  "never",
  "up_to_date",
  "available",
  "installed",
  "incompatible",
  "no_network",
  "no_time",
  "unreachable",
  "not_published",
  "tls_error",
  "bad_manifest",
  "bad_download",
  "flash_error",
] as const;

export function describeWebState(web: WebAppStatus): string {
  return among(WEB_STATES, web.state)
    ? i18n.t(`device:webApp.states.${web.state}`)
    : i18n.t("device:webApp.unknownState", { state: web.state });
}

export function describeWebResult(web: WebAppStatus): string {
  if (web.last_result === "available" && web.available !== null)
    return i18n.t("device:webApp.availableVersion", { version: web.available });
  return among(WEB_RESULTS, web.last_result)
    ? i18n.t(`device:webApp.results.${web.last_result}`)
    : i18n.t("device:webApp.unknownResult", { result: web.last_result });
}

/** When the board tries again to install a missing app, in plain words, or null when no try is waiting. */
export function describeRetry(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 60) return i18n.t("device:webApp.retrySoon");
  return i18n.t("device:webApp.retryIn", { count: Math.round(seconds / 60) });
}

/** Whether the card offers to install the web app version the last check found. */
export function canInstallWeb(update: UpdateStatus, wifi: WifiStatus | null, webUpdatesOn: boolean): boolean {
  const web = update.web;
  if (!web || !webUpdatesOn || updateBusy(update) || update.trial) return false;
  if (wifi !== null && wifi.state !== "connected") return false;
  return web.last_result === "available" && web.available !== null;
}

/** What the board's own check says of its firmware, or null when it says nothing (never checked, failed, off). */
export function boardVerdict(
  update: UpdateStatus,
  settings: Settings | null,
): "available" | "up_to_date" | "skipped" | null {
  if (!firmwareUpdatesOn(update, settings)) return null;
  if (update.last_result === "available") return "available";
  if (update.last_result === "up_to_date") return "up_to_date";
  if (update.last_result === "skipped") return "skipped";
  return null;
}

/**
 * Where the state of the firmware comes from: the board's own check when it has a verdict (unless it says up to date
 * while the published version is newer), else the comparison with the published firmware (`published`, null when
 * unknown). Both the Firmware card and "Your Zenit" follow it, so they never disagree. `update` is null for a board
 * that reports no check or is not connected.
 */
export function firmwareStateSource(
  update: UpdateStatus | null,
  settings: Settings | null,
  published: FirmwareState | null,
):
  | { from: "board"; verdict: "available" | "up_to_date" | "skipped" }
  | { from: "published"; state: FirmwareState }
  | null {
  const verdict = update === null ? null : boardVerdict(update, settings);
  // The board may have looked before the last release, or read another site: a newer published version is still said
  if (verdict === "up_to_date" && published === "update_available") return { from: "published", state: published };
  if (verdict !== null) return { from: "board", verdict };
  return published === null ? null : { from: "published", state: published };
}

/** The short state of the firmware for "Your Zenit" (see `firmwareStateSource`); "Updating" while firmware installs. */
export function firmwareSummary(
  update: UpdateStatus | null,
  settings: Settings | null,
  published: FirmwareState | null,
): string | null {
  if (update !== null && firmwareBusy(update)) return i18n.t("device:board.summary.updating");
  const source = firmwareStateSource(update, settings, published);
  if (source === null) return null;
  if (source.from === "board") return i18n.t(`device:board.summary.${source.verdict}`);
  return source.state === "unknown" ? null : i18n.t(`device:board.summary.${source.state}`);
}
