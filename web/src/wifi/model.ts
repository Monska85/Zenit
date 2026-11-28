// SPDX-License-Identifier: GPL-3.0-or-later

// What the WiFi card shows and checks: the limits of Improv's "send WiFi settings"
// (docs/board/wifi-and-updates-v1.md#limits) and the sentences for the states of `status.wifi`.

import { i18n, message, type Message } from "../i18n";

export const WIFI_LIMITS = {
  ssid_bytes: { min: 1, max: 32 },
  password_chars: { min: 8, max: 63 },
  /** A password of exactly this many hexadecimal digits is the key itself. */
  password_hex_digits: 64,
} as const;

const encoder = new TextEncoder();

/** Whether a text has no lone surrogate, so that it encodes to UTF-8 as it is. */
function wellFormed(text: string): boolean {
  try {
    encodeURIComponent(text);
    return true;
  } catch {
    return false;
  }
}

/** Why a network name is not acceptable, or null: 1 to 32 bytes of valid UTF-8 with no control character (C0 or DEL),
 * the rule of the board (`valid_wifi_name`, docs/board/wifi-and-updates-v1.md#limits). */
export function ssidProblem(ssid: string): Message | null {
  const size = encoder.encode(ssid).length;
  if (size < WIFI_LIMITS.ssid_bytes.min) return message("device:improv.problems.noName");
  if (size > WIFI_LIMITS.ssid_bytes.max) return message("device:improv.problems.nameLength");
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(ssid) || !wellFormed(ssid)) return message("device:improv.problems.nameCharacters");
  return null;
}

/** Why a password is not acceptable, or null: empty (an open network), 8 to 63 characters, or 64 hexadecimal digits. */
export function passwordProblem(password: string): Message | null {
  if (password === "") return null;
  if (password.includes("\0")) return message("device:improv.problems.passwordUnusable");
  if (/^[0-9A-Fa-f]{64}$/.test(password)) return null;
  const size = encoder.encode(password).length;
  if (size < WIFI_LIMITS.password_chars.min || size > WIFI_LIMITS.password_chars.max)
    return message("device:improv.problems.passwordLength");
  return null;
}

/** The sentence for the state of the board's WiFi. */
export function describeWifiState(state: string, ssid: string | null): string {
  switch (state) {
    case "not_configured":
      return i18n.t("device:wifi.states.not_configured");
    case "connecting":
    case "connected":
    case "not_found":
    case "wrong_password":
    case "no_address":
      return ssid === null
        ? i18n.t(`device:wifi.statesUnnamed.${state}`)
        : i18n.t(`device:wifi.states.${state}`, { name: ssid });
    default:
      return i18n.t("device:wifi.unknownState");
  }
}

/** How strong a signal is, from dBm. */
export function signalLevel(rssi: number): "strong" | "fair" | "weak" {
  if (rssi >= -60) return "strong";
  if (rssi >= -75) return "fair";
  return "weak";
}

/** The signal in words, from dBm. */
export const describeSignal = (rssi: number): string => i18n.t(`device:wifi.signals.${signalLevel(rssi)}`);

/** The address to open on a phone or computer once the board is on WiFi. */
export const boardAddress = (hostname: string): string => `http://${hostname}.local/`;

/** Recent Android versions keep Chrome off the local network until it has the Nearby devices permission. */
export const phoneAccessHint = (): string => i18n.t("device:wifi.phoneAccessHint");
