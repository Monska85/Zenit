// SPDX-License-Identifier: GPL-3.0-or-later

// Opening a connection from the page: the port chooser of Web Serial and the WebSocket of an address.

import { boardUrl, mixedContentBlocked } from "../protocol/address";
import { ESPRESSIF_VENDOR_ID, openSerial, type SerialPortLike } from "../protocol/serial";
import { openWebSocket } from "../protocol/websocket";
import { OpenFailed, type BoardSession, type Opener, type Visibility } from "./session";

interface SerialApi {
  requestPort(options: { filters: Array<{ usbVendorId: number }> }): Promise<SerialPortLike>;
}

const serialApi = (): SerialApi | undefined => (navigator as Navigator & { serial?: SerialApi }).serial;

/** Whether this browser can talk to a USB serial port (Chrome and Edge, and Chrome on Android). */
export const serialSupported = (): boolean => serialApi() !== undefined;

export const MIXED_CONTENT_MESSAGE =
  "Your browser does not let this page reach a Zenit over WiFi. Connect with the USB cable, or open the Zenit's own address in the browser.";

/**
 * The opener of a USB connection: it asks for a port, or uses the one it was given before when that still opens (a
 * reconnection), and asks again only when it does not. A closed chooser gives null, not an error.
 */
export function usbOpener(): Opener {
  let last: SerialPortLike | null = null;
  return async () => {
    const serial = serialApi();
    if (!serial) throw new OpenFailed("This browser cannot use a USB cable. Use Chrome or Edge.");
    if (last) {
      try {
        return await openSerial(last);
      } catch {
        last = null; // gone or in use: ask again
      }
    }
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

/** The opener of a connection to the address typed, or the sentence to show when it cannot start. */
export function addressOpener(typed: string): Opener | string {
  const address = boardUrl(typed);
  if ("error" in address) return address.error;
  if (mixedContentBlocked(location.protocol, address.url)) return MIXED_CONTENT_MESSAGE;
  return async () => {
    try {
      return await openWebSocket(address.url);
    } catch {
      throw new OpenFailed("Could not reach Zenit at that address. Check that it is on, and on the same network.");
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
