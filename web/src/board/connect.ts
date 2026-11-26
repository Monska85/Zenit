// SPDX-License-Identifier: GPL-3.0-or-later

// Opening a connection from the page: the port chooser of Web Serial and the WebSocket of an address.

import {
  boardUrl,
  connectTimeoutFor,
  localNetworkAccessFor,
  mixedContentBlocked,
  mayAskFor,
  permissionNameFor,
  type LocalPermission,
} from "../protocol/address";
import { ESPRESSIF_VENDOR_ID, openSerial, type SerialPortLike } from "../protocol/serial";
import { openWebSocket } from "../protocol/websocket";
import type { LineTransport } from "../protocol/transport";
import { OpenFailed, type BoardSession, type Opener, type Visibility } from "./session";

interface SerialApi {
  requestPort(options: { filters: Array<{ usbVendorId: number }> }): Promise<SerialPortLike>;
}

const serialApi = (): SerialApi | undefined => (navigator as Navigator & { serial?: SerialApi }).serial;

/** Whether this browser can talk to a USB serial port (Chrome and Edge, and Chrome on Android). */
export const serialSupported = (): boolean => serialApi() !== undefined;

interface BrandsApi {
  userAgentData?: { brands?: Array<{ brand: string; version: string }> };
}

/**
 * Whether this browser lets a secure page open `ws://` to the local network after asking the person (Chrome's Local
 * Network Access). Firefox, Safari and older Chromium block an unencrypted socket from a secure page.
 */
export const localNetworkAccess = (): boolean =>
  localNetworkAccessFor((navigator as Navigator & BrandsApi).userAgentData?.brands);

export const MIXED_CONTENT_MESSAGE =
  "This browser does not let this page reach a Zenit over WiFi. Open the Zenit's own address in the browser, or use an up-to-date Chrome or Edge.";

export const LOCAL_ADDRESS_MESSAGE =
  "From this page, use the Zenit's .local name or its address on your network, like zenit-1a2b.local or 192.168.1.20.";

const UNREACHABLE = "Could not reach Zenit at that address. Check that it is on, and on the same network.";

export const UNREACHABLE_FROM_SITE = `${UNREACHABLE} If Chrome asked to let this page find devices on your local network, allow it and connect again.`;

/**
 * The opener of a USB connection: it asks for a port, or uses the one it was given before when that still opens (a
 * reconnection), and asks again only when it does not. A closed chooser gives null, not an error.
 */
export function usbOpener(): Opener {
  let last: SerialPortLike | null = null;
  return async (interactive) => {
    const serial = serialApi();
    if (!serial) throw new OpenFailed("This browser cannot use a USB cable. Use Chrome or Edge.");
    if (last) {
      try {
        return await openSerial(last);
      } catch {
        last = null; // gone or in use: ask again
      }
    }
    // The chooser needs a click: a try the page makes by itself can only reuse the port it had
    if (!interactive) throw new OpenFailed("The USB port is not there yet.");
    let port: SerialPortLike;
    try {
      port = await serial.requestPort({ filters: [{ usbVendorId: ESPRESSIF_VENDOR_ID }] });
    } catch (error) {
      // No port chosen: the person closed the chooser
      if (error instanceof DOMException && error.name === "NotFoundError") return null;
      throw new OpenFailed("The USB port could not be chosen.");
    }
    try {
      const transport = await openSerial(port);
      last = port;
      return transport;
    } catch {
      throw new OpenFailed("The USB port could not be opened. Another program or browser tab may be using it.");
    }
  };
}

/**
 * What the browser says about its local network permission for `hostname`, or "unknown" when it does not know the
 * permission (a browser that cannot answer may still ask the person).
 */
async function localPermission(hostname: string): Promise<LocalPermission> {
  try {
    const name = permissionNameFor(hostname);
    const status = await navigator.permissions.query({ name } as unknown as PermissionDescriptor);
    return status.state;
  } catch {
    return "unknown";
  }
}

/** What opening a connection by address needs from the page: its own place, the browser, and the socket. */
export interface AddressEnvironment {
  protocol: string;
  hostname: string;
  localNetworkAccess: boolean;
  permission: (hostname: string) => Promise<LocalPermission>;
  open: (url: string, timeoutMs: number) => Promise<LineTransport>;
}

const browserEnvironment = (): AddressEnvironment => ({
  protocol: location.protocol,
  hostname: location.hostname,
  localNetworkAccess: localNetworkAccess(),
  permission: localPermission,
  open: (url, timeoutMs) => openWebSocket(url, undefined, timeoutMs),
});

/** The opener of a connection to the address typed, or the sentence to show when it cannot start. */
export function addressOpener(typed: string, environment: AddressEnvironment = browserEnvironment()): Opener | string {
  const { protocol, hostname, localNetworkAccess: lna } = environment;
  const address = boardUrl(typed);
  if ("error" in address) return address.error;
  if (mixedContentBlocked(protocol, address.url, lna)) return lna ? LOCAL_ADDRESS_MESSAGE : MIXED_CONTENT_MESSAGE;
  const target = new URL(address.url);
  // From a secure page the browser may ask before the first connection to the local network; a refusal looks like no answer
  const unreachable = protocol === "https:" && target.protocol === "ws:" ? UNREACHABLE_FROM_SITE : UNREACHABLE;
  return async () => {
    // While the browser may be asking the person, the connection may wait for the answer: it gets longer to open. The
    // permission is read only where the browser has Local Network Access and may ask.
    const asks = lna && mayAskFor(protocol, hostname, address.url);
    const permission = asks ? await environment.permission(target.hostname) : "unknown";
    try {
      return await environment.open(address.url, connectTimeoutFor(protocol, hostname, address.url, permission));
    } catch {
      throw new OpenFailed(unreachable);
    }
  };
}

/** Asks for a port and connects over it. A closed chooser is not an error. */
export const connectUsb = (session: BoardSession): Promise<void> => session.open(usbOpener(), "USB");

/** Connects to a board or the simulator at the address typed. Returns the sentence to show when it could not start. */
export async function connectAddress(session: BoardSession, typed: string): Promise<string | null> {
  const opener = addressOpener(typed);
  if (typeof opener === "string") return opener;
  await session.open(opener, typed.trim());
  return null;
}

/** The visibility of this page, for the session's polling. */
export const pageVisibility: Visibility = {
  hidden: () => document.visibilityState === "hidden",
  onShown: (listener) => {
    const handler = (): void => {
      if (document.visibilityState === "visible") listener();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  },
};
