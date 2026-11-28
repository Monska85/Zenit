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
import { message, type Message } from "../i18n";
import { OpenFailed, type BoardSession, type Opener, type Visibility } from "./session";

export interface SerialApi {
  requestPort(options: { filters: Array<{ usbVendorId: number }> }): Promise<SerialPortLike>;
  /** The ports this page was granted before. */
  getPorts(): Promise<SerialPortLike[]>;
}

const serialApi = (): SerialApi | undefined => (navigator as Navigator & { serial?: SerialApi }).serial;

/** The one Espressif port this page was granted, or null when there is none or more than one. */
async function onlyGrantedPort(serial: SerialApi): Promise<SerialPortLike | null> {
  try {
    const ports = (await serial.getPorts()).filter((port) => port.getInfo?.().usbVendorId === ESPRESSIF_VENDOR_ID);
    return ports.length === 1 ? (ports[0] as SerialPortLike) : null;
  } catch {
    return null;
  }
}

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

export const MIXED_CONTENT_MESSAGE = message("errors:open.mixedContent");

const UNREACHABLE = message("errors:open.unreachable");

export const UNREACHABLE_FROM_SITE = message("errors:open.unreachableFromSite");

/**
 * The opener of a USB connection: it asks for a port, or uses the one it was given before when that still opens (a
 * reconnection), and asks again only when it does not. A closed chooser gives null, not an error. A try the page makes
 * by itself keeps the port when it does not open yet (a board that restarts comes back in a few seconds), and also tries
 * the one Espressif port the page was granted: the browser may hand out a new port object when the board comes back.
 */
export function usbOpener(api: () => SerialApi | undefined = serialApi): Opener {
  let last: SerialPortLike | null = null;
  return async (interactive) => {
    const serial = api();
    if (!serial) throw new OpenFailed(message("errors:open.noSerial"));
    if (last) {
      try {
        return await openSerial(last);
      } catch {
        // Gone or in use: a click asks again, a try of the page's own keeps it for the next try
        if (interactive) last = null;
      }
    }
    // The chooser needs a click: a try the page makes by itself can only reuse a port it was granted
    if (!interactive) {
      const granted = await onlyGrantedPort(serial);
      if (granted !== null && granted !== last) {
        try {
          const transport = await openSerial(granted);
          last = granted;
          return transport;
        } catch {
          // not back yet either
        }
      }
      throw new OpenFailed(message("errors:open.portNotThere"));
    }
    let port: SerialPortLike;
    try {
      port = await serial.requestPort({ filters: [{ usbVendorId: ESPRESSIF_VENDOR_ID }] });
    } catch (error) {
      // No port chosen: the person closed the chooser
      if (error instanceof DOMException && error.name === "NotFoundError") return null;
      throw new OpenFailed(message("errors:open.portNotChosen"));
    }
    try {
      const transport = await openSerial(port);
      last = port;
      return transport;
    } catch {
      throw new OpenFailed(message("errors:open.portBusy"));
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
export function addressOpener(typed: string, environment: AddressEnvironment = browserEnvironment()): Opener | Message {
  const { protocol, hostname, localNetworkAccess: lna } = environment;
  const address = boardUrl(typed);
  if ("error" in address) return address.error;
  // Every address boardUrl accepts is local, so with Local Network Access none is blocked
  if (mixedContentBlocked(protocol, address.url, lna)) return MIXED_CONTENT_MESSAGE;
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

/**
 * Connects to a board or the simulator at the address typed. `problem` is the sentence to show when it could not start;
 * `reached` says whether the board answered (the session is connected, or asks for the login), so only an address that
 * worked is remembered.
 */
export async function connectAddress(
  session: BoardSession,
  typed: string,
  environment?: AddressEnvironment,
): Promise<{ problem: Message | null; reached: boolean }> {
  const opener = addressOpener(typed, environment);
  if (typeof opener !== "function") return { problem: opener, reached: false };
  const label = typed.trim();
  await session.open(opener, label);
  const { phase, label: now } = session.getState();
  return { problem: null, reached: now === label && (phase === "connected" || phase === "login") };
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
