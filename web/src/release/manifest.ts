// SPDX-License-Identifier: GPL-3.0-or-later

// The firmware manifest the release workflow publishes under firmware/ (docs/web/web-app-v1.md#installing-firmware),
// and what the app says of a board's version next to it.

import { compareVersions, parseVersion } from "./semver";

export interface FirmwareManifest {
  name: string;
  version: string;
}

/** The manifest in `value`, or null when it is not a Zenit manifest of an ESP32-C3 with a semantic version. */
export function readManifest(value: unknown): FirmwareManifest | null {
  if (typeof value !== "object" || value === null) return null;
  const { name, version, builds } = value as Record<string, unknown>;
  if (name !== "Zenit" || typeof version !== "string" || parseVersion(version) === null || !Array.isArray(builds)) {
    return null;
  }
  const chip = (build: unknown): boolean =>
    typeof build === "object" && build !== null && (build as Record<string, unknown>)["chipFamily"] === "ESP32-C3";
  return builds.some(chip) ? { name, version } : null;
}

export type FirmwareState = "up_to_date" | "update_available" | "newer" | "unknown";

/** How a board's `info.firmware` stands against the published version: older, equal, newer, or not comparable. */
export function firmwareState(boardVersion: string, publishedVersion: string): FirmwareState {
  const board = parseVersion(boardVersion);
  const published = parseVersion(publishedVersion);
  if (!board || !published) return "unknown";
  const order = compareVersions(board, published);
  return order < 0 ? "update_available" : order === 0 ? "up_to_date" : "newer";
}
