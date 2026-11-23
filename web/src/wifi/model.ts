// SPDX-License-Identifier: GPL-3.0-or-later

// What the WiFi card shows and checks: the limits of Improv's "send WiFi settings"
// (docs/board/wifi-and-updates-v1.md#limits) and the sentences for the states of `status.wifi`.

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
export function ssidProblem(ssid: string): string | null {
  const size = encoder.encode(ssid).length;
  if (size < WIFI_LIMITS.ssid_bytes.min) return "Choose or type the name of your WiFi network.";
  if (size > WIFI_LIMITS.ssid_bytes.max) return "A WiFi network name has 1 to 32 characters.";
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(ssid) || !wellFormed(ssid))
    return "Zenit cannot use a network name with control or invalid characters.";
  return null;
}

/** Why a password is not acceptable, or null: empty (an open network), 8 to 63 characters, or 64 hexadecimal digits. */
export function passwordProblem(password: string): string | null {
  if (password === "") return null;
  if (password.includes("\0")) return "That password cannot be used.";
  if (/^[0-9A-Fa-f]{64}$/.test(password)) return null;
  const size = encoder.encode(password).length;
  if (size < WIFI_LIMITS.password_chars.min || size > WIFI_LIMITS.password_chars.max)
    return "A WiFi password has 8 to 63 characters, or leave it empty for an open network.";
  return null;
}

/** The sentence for the state of the board's WiFi. */
export function describeWifiState(state: string, ssid: string | null): string {
  const name = ssid === null ? "the network" : `"${ssid}"`;
  switch (state) {
    case "not_configured":
      return "Not set up. Zenit is not on a WiFi network.";
    case "connecting":
      return `Connecting to ${name}...`;
    case "connected":
      return `Connected to ${name}.`;
    case "not_found":
      return `Zenit cannot see ${name}. It keeps trying.`;
    case "wrong_password":
      return `${name} refused the password. Zenit keeps trying.`;
    case "no_address":
      return `Zenit joined ${name} but got no address. It keeps trying.`;
    default:
      return "Zenit reports a WiFi state this app does not know.";
  }
}

/** The signal in words, from dBm. */
export function describeSignal(rssi: number): string {
  if (rssi >= -60) return "strong";
  if (rssi >= -75) return "fair";
  return "weak";
}

/** The address to open on a phone or computer once the board is on WiFi. */
export const boardAddress = (hostname: string): string => `http://${hostname}.local/`;

/** Recent Android versions keep Chrome off the local network until it has the Nearby devices permission. */
export const PHONE_ACCESS_HINT =
  "If an Android phone cannot open it, allow Chrome to find devices on your network: Settings, Apps, Chrome, Permissions, Nearby devices.";
