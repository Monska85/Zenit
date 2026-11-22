// SPDX-License-Identifier: GPL-3.0-or-later

// What the firmware card says about `status.update` (docs/board/wifi-and-updates-v1.md#status), in plain words.

import type { UpdateStatus, WifiStatus } from "../protocol/types";

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
    case "downloading":
      return update.progress === null ? "Downloading the update..." : `Downloading the update: ${update.progress} %`;
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

/** Whether "Check now" works: updates on, nothing running, connected. */
export function canCheck(update: UpdateStatus, wifi: WifiStatus | null): boolean {
  return updatesOn(update) && !updateBusy(update) && (wifi === null || wifi.state === "connected");
}

/** When the last check ended, in the reader's local time, or null. */
export function formatCheckTime(unixSeconds: number | null, locale?: string): string | null {
  if (unixSeconds === null) return null;
  return new Date(unixSeconds * 1000).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}
