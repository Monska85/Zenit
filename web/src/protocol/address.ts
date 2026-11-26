// SPDX-License-Identifier: GPL-3.0-or-later

// The address a person types to reach a board or the simulator over WebSocket (docs/web/web-app-v1.md#websocket).

import { CONNECT_TIMEOUT_MS } from "./websocket";

export type AddressResult = { url: string } | { error: string };

const HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/;
const IPV6 = /^\[[0-9A-Fa-f:.]+\]$/;

function validPort(port: string): boolean {
  return /^[0-9]{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535;
}

/** The sentence for an address outside the person's own network: the app talks to nothing on the internet. */
export const PRIVATE_ONLY_MESSAGE =
  "This app connects only to a Zenit on your own network: a name that ends in .local, like zenit-1a2b.local, or a local address, like 192.168.1.20 or 10.0.0.5. For the simulator on this computer, use ws://127.0.0.1:8765.";

/**
 * The WebSocket URL for what was typed. A full `ws://` URL is used as typed; a host name or address, with an optional
 * port, becomes `ws://<host>/ws`. Only an address on this computer or the local network is accepted (`localHost`), so the
 * app never talks to a server on the internet; `wss://` is refused, since a Zenit has no encrypted connection.
 */
export function boardUrl(typed: string): AddressResult {
  const text = typed.trim();
  if (text === "") return { error: "Type the address of your Zenit." };
  let address: string;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return { error: "That is not a valid address." };
    }
    if (url.protocol !== "ws:") return { error: "The address must start with ws://." };
    if (url.username || url.password || url.hostname === "") return { error: "That is not a valid address." };
    address = text;
  } else {
    const split = /^(\[[^\]]*\]|[^:]*)(?::(.*))?$/.exec(text);
    const host = split?.[1] ?? "";
    const port = split?.[2];
    if (!(HOST.test(host) || IPV6.test(host)) || (port !== undefined && !validPort(port))) {
      return { error: "That does not look like an address. Try zenit-1a2b.local or 192.168.1.20." };
    }
    address = `ws://${host}${port === undefined ? "" : `:${port}`}/ws`;
  }
  // The host as the browser will use it: other spellings of an IPv4 address (0x7f.1, 3232235796) are normalized first
  let hostname: string;
  try {
    hostname = new URL(address).hostname;
  } catch {
    return { error: "That is not a valid address." };
  }
  if (!localHost(hostname)) return { error: PRIVATE_ONLY_MESSAGE };
  return { url: address };
}

const SAME_COMPUTER = new Set(["localhost", "127.0.0.1", "[::1]"]);

const IPV4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/;
const LOCAL_NAME = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.local\.?$/;

/** A private, loopback or link-local IPv4 address: 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16. */
function privateIpv4(host: string): boolean {
  if (!IPV4.test(host)) return false;
  const [a, b] = host.split(".").map(Number) as [number, number];
  return (
    a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  );
}

/** The loopback, unique local or link-local IPv6 address in brackets: ::1, fc00::/7, fe80::/10. */
function privateIpv6(host: string): boolean {
  const inner = /^\[([0-9a-f:.]+)\]$/.exec(host)?.[1];
  if (inner === undefined) return false;
  if (inner === "::1") return true;
  if (inner.startsWith(":")) return false;
  const first = parseInt(inner.slice(0, inner.indexOf(":")), 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/**
 * Whether a host is on this computer or the local network: `localhost`, a `.local` name, a private, loopback or
 * link-local IPv4 address (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16) or IPv6 address (::1, fc00::/7, fe80::/10).
 * These are the only addresses the app connects to, and the ones Chrome's Local Network Access treats as local by the
 * address alone.
 */
export function localHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || LOCAL_NAME.test(host)) return true;
  return privateIpv4(host) || privateIpv6(host) || privateIpv6(`[${host}]`);
}

/** The first Chromium release whose Local Network Access covers WebSockets (docs/web/web-app-v1.md#websocket). */
const LNA_WEBSOCKET_CHROMIUM = 147;

/**
 * Whether a browser with these User-Agent Client Hints brands (`navigator.userAgentData.brands`, absent in Firefox and
 * Safari) lets a secure page open `ws://` to the local network after asking the person: Chromium from
 * LNA_WEBSOCKET_CHROMIUM on.
 */
export function localNetworkAccessFor(brands: ReadonlyArray<{ brand: string; version: string }> | undefined): boolean {
  const chromium = brands?.find((entry) => entry.brand === "Chromium");
  if (!chromium || !/^[0-9]+$/.test(chromium.version)) return false;
  return Number(chromium.version) >= LNA_WEBSOCKET_CHROMIUM;
}

/** The opening window while the browser may be waiting for the person to answer its local network prompt. */
export const PERMISSION_CONNECT_TIMEOUT_MS = 60_000;

/** What the browser says about its local network permission for a target: its own states, or "unknown" when it cannot tell. */
export type LocalPermission = "granted" | "denied" | "prompt" | "unknown";

/**
 * Whether the browser may ask the person before a connection to `url` from a page loaded over `pageProtocol` from
 * `pageHostname` opens: an unencrypted socket from a secure page of another site to the local network or this computer.
 */
export function mayAskFor(pageProtocol: string, pageHostname: string, url: string): boolean {
  const target = new URL(url);
  return (
    pageProtocol === "https:" && target.protocol === "ws:" && !localHost(pageHostname) && localHost(target.hostname)
  );
}

/**
 * The opening window of a connection to `url`: longer while the browser may ask the person and the permission is not
 * answered yet.
 */
export function connectTimeoutFor(
  pageProtocol: string,
  pageHostname: string,
  url: string,
  permission: LocalPermission,
): number {
  const unanswered = permission === "prompt" || permission === "unknown";
  return mayAskFor(pageProtocol, pageHostname, url) && unanswered ? PERMISSION_CONNECT_TIMEOUT_MS : CONNECT_TIMEOUT_MS;
}

/**
 * The browser permission that covers a target: loopback and the local network are asked separately. The older name
 * `local-network-access` is never queried: Chrome's guide warns that the query can crash older releases.
 */
export const permissionNameFor = (hostname: string): string =>
  SAME_COMPUTER.has(hostname) || /^127\./.test(hostname) ? "loopback-network" : "local-network";

/**
 * Whether a page at this protocol and host name cannot reach a Zenit by an address at all: a page loaded over `https://`
 * from a site other than this computer, in a browser without Local Network Access. (A page on this computer can still
 * open `ws://127.0.0.1`.)
 */
export const addressUnavailableHere = (pageProtocol: string, pageHostname: string, lna: boolean): boolean =>
  pageProtocol === "https:" && !lna && !SAME_COMPUTER.has(pageHostname) && !SAME_COMPUTER.has(`[${pageHostname}]`);

/**
 * Whether a browser would refuse this connection from a page loaded over `pageProtocol` ("https:" or "http:"): an
 * unencrypted `ws://` from an `https://` page, unless it goes to the same computer or, in a browser with Local Network
 * Access, to a `.local` name or a private address.
 */
export function mixedContentBlocked(pageProtocol: string, url: string, lna: boolean): boolean {
  const target = new URL(url);
  if (pageProtocol !== "https:" || target.protocol !== "ws:") return false;
  if (SAME_COMPUTER.has(target.hostname)) return false;
  return !(lna && localHost(target.hostname));
}
