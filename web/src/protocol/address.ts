// SPDX-License-Identifier: GPL-3.0-or-later

// The address a person types to reach a board or the simulator over WebSocket (docs/web/web-app-v1.md#websocket).

export type AddressResult = { url: string } | { error: string };

const HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/;
const IPV6 = /^\[[0-9A-Fa-f:.]+\]$/;

function validPort(port: string): boolean {
  return /^[0-9]{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535;
}

/**
 * The WebSocket URL for what was typed. A full `ws://` or `wss://` URL is used as typed; a host name or address, with
 * an optional port, becomes `ws://<host>/ws`.
 */
export function boardUrl(typed: string): AddressResult {
  const text = typed.trim();
  if (text === "") return { error: "Type the address of your Zenit." };
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return { error: "That is not a valid address." };
    }
    if (url.protocol !== "ws:" && url.protocol !== "wss:")
      return { error: "The address must start with ws:// or wss://." };
    if (url.username || url.password || url.hostname === "") return { error: "That is not a valid address." };
    return { url: text };
  }
  const split = /^(\[[^\]]*\]|[^:]*)(?::(.*))?$/.exec(text);
  const host = split?.[1] ?? "";
  const port = split?.[2];
  if (!(HOST.test(host) || IPV6.test(host)) || (port !== undefined && !validPort(port))) {
    return { error: "That does not look like an address. Try zenit-1a2b.local or 192.168.1.20." };
  }
  return { url: `ws://${host}${port === undefined ? "" : `:${port}`}/ws` };
}

const SAME_COMPUTER = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether a page at this protocol and host name cannot reach a Zenit by an address at all: a page loaded over `https://`
 * from a site other than this computer. (A page on this computer can still open `ws://127.0.0.1`.)
 */
export const addressUnavailableHere = (pageProtocol: string, pageHostname: string): boolean =>
  pageProtocol === "https:" && !SAME_COMPUTER.has(pageHostname) && !SAME_COMPUTER.has(`[${pageHostname}]`);

/**
 * Whether a browser would refuse this connection from a page loaded over `pageProtocol` ("https:" or "http:"): an
 * unencrypted `ws://` from an `https://` page, unless it goes to the same computer.
 */
export function mixedContentBlocked(pageProtocol: string, url: string): boolean {
  const target = new URL(url);
  return pageProtocol === "https:" && target.protocol === "ws:" && !SAME_COMPUTER.has(target.hostname);
}
