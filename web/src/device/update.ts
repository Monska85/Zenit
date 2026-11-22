// SPDX-License-Identifier: GPL-3.0-or-later

// What the firmware card says about `status.update` (docs/board/wifi-and-updates-v1.md#status), in plain words.

import type { Settings, UpdateStatus, WebAppStatus, WifiStatus } from "../protocol/types";

/** Whether the board looks for new versions of the web app: the mode is not off and `update_web` is not false. */
export const webUpdatesOn = (settings: Settings | null): boolean =>
  settings !== null && settings.update_mode !== "off" && settings.update_web !== false;

/** The sentence for each `last_result`. */
const RESULTS: Record<string, string> = {
  never: "Zenit has not looked for an update yet.",
  up_to_date: "Your Zenit has the latest firmware.",
  available: "A new version is available.",
  skipped: "A newer version exists, but it did not work on this Zenit before, so Zenit does not install it by itself.",
  installed: "The new version was installed. Zenit is restarting.",
  no_network: "Zenit is not connected to WiFi, so it could not look for an update.",
  no_time: "Zenit does not know the time yet, so it could not look for an update. Try again in a minute.",
  unreachable: "Zenit could not reach the update site. Check that your internet connection works.",
  not_published: "The project site has no firmware published yet, so there is nothing to install.",
  tls_error: "Zenit did not trust the update site's security certificate, so it downloaded nothing.",
  bad_manifest: "The update information on the site is not valid, so Zenit downloaded nothing.",
  bad_download: "The download was damaged, so Zenit did not install it. Nothing was changed.",
  flash_error: "Zenit could not write the new firmware. Nothing was changed.",
};

export function describeResult(result: string): string {
  return RESULTS[result] ?? `The last check ended with a result this app does not know (${result}).`;
}

/** What the board is doing now, or null when it is idle. */
export function describeUpdateState(update: UpdateStatus): string | null {
  switch (update.state) {
    case "idle":
      return null;
    case "checking":
      return "Looking for an update...";
    case "downloading": {
      const what = update.target === "web" ? "the new app" : "the update";
      return update.progress === null ? `Downloading ${what}...` : `Downloading ${what}: ${update.progress} %`;
    }
    case "verifying":
      return "Checking the download...";
    case "restarting":
      return "Restarting to start the new version...";
    default:
      return `Zenit is busy with the update (${update.state}).`;
  }
}

/** Whether the board is busy with an update: nothing else may be asked of it. */
export const updateBusy = (update: UpdateStatus): boolean => update.state !== "idle";

/** Whether this firmware or the last checks leave the update choices open at all. */
export const updatesOn = (update: UpdateStatus): boolean => update.mode !== "off";

export type UpdateAction = "none" | "install" | "force";

/**
 * Which install button the card offers: the normal one for a version that is available, "Install anyway" for the version
 * on the skip list, none otherwise (nothing found, a board on trial, a check or an install running).
 */
export function installAction(update: UpdateStatus, wifi: WifiStatus | null): UpdateAction {
  if (!updatesOn(update) || updateBusy(update) || update.available === null || update.trial) return "none";
  if (wifi !== null && wifi.state !== "connected") return "none";
  if (update.last_result === "available") return "install";
  if (update.last_result === "skipped") return "force";
  return "none";
}

/**
 * Whether "Check now" works: updates on, nothing running, connected. With the firmware's updates off, a check still
 * looks for a new app when `webUpdatesOn`.
 */
export function canCheck(update: UpdateStatus, wifi: WifiStatus | null, webUpdatesOn = false): boolean {
  const on = updatesOn(update) || (webUpdatesOn && update.web !== undefined);
  return on && !updateBusy(update) && (wifi === null || wifi.state === "connected");
}

/** When the last check ended, in the reader's local time, or null. */
export function formatCheckTime(unixSeconds: number | null, locale?: string): string | null {
  if (unixSeconds === null) return null;
  return new Date(unixSeconds * 1000).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/** The sentence for each state of the web app in the board's own partition. */
const WEB_STATES: Record<string, string> = {
  ok: "Zenit has this app on board, ready for any phone or computer on your WiFi.",
  installing: "Zenit is installing a new version of this app.",
  missing: "Zenit has no copy of this app on board right now. It installs one by itself as soon as it can.",
  incompatible: "The copy of this app on Zenit does not suit its firmware. Zenit installs a suitable one by itself.",
};

/** The sentence for each `last_result` of the web app. */
const WEB_RESULTS: Record<string, string> = {
  never: "Zenit has not looked for a new version of the app yet.",
  up_to_date: "Zenit has the latest version of the app.",
  available: "A new version of the app is available.",
  installed: "The new version of the app was installed. Pages open on Zenit load it by themselves.",
  incompatible: "A newer version of the app exists, but it needs newer firmware, so Zenit keeps the one it has.",
  no_network: "Zenit is not connected to WiFi, so it could not look for a new version of the app.",
  no_time:
    "Zenit does not know the time yet, so it could not look for a new version of the app. Try again in a minute.",
  unreachable: "Zenit could not reach the update site. Check that your internet connection works.",
  not_published: "The project site has no app published yet, so there is nothing to install.",
  tls_error: "Zenit did not trust the update site's security certificate, so it downloaded nothing.",
  bad_manifest: "The app's update information on the site is not valid, so Zenit downloaded nothing.",
  bad_download: "The download of the app was damaged, so Zenit did not keep it.",
  flash_error: "Zenit could not write the new version of the app.",
};

export function describeWebState(web: WebAppStatus): string {
  return WEB_STATES[web.state] ?? `The app on Zenit is in a state this page does not know (${web.state}).`;
}

export function describeWebResult(web: WebAppStatus): string {
  if (web.last_result === "available" && web.available !== null)
    return `Version ${web.available} of the app is available.`;
  return (
    WEB_RESULTS[web.last_result] ?? `The last check ended with a result this app does not know (${web.last_result}).`
  );
}

/** When the board tries again to install a missing app, in plain words, or null when no try is waiting. */
export function describeRetry(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 60) return "Zenit tries again in less than a minute.";
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "Zenit tries again in about a minute." : `Zenit tries again in about ${minutes} minutes.`;
}

/** Whether the card offers to install the web app version the last check found. */
export function canInstallWeb(update: UpdateStatus, wifi: WifiStatus | null, webUpdatesOn: boolean): boolean {
  const web = update.web;
  if (!web || !webUpdatesOn || updateBusy(update) || update.trial) return false;
  if (wifi !== null && wifi.state !== "connected") return false;
  return web.last_result === "available" && web.available !== null;
}
