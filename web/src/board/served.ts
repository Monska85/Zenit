// SPDX-License-Identifier: GPL-3.0-or-later

// A page served by the board itself (docs/board/wifi-and-updates-v1.md#the-served-web-app): it asks its own origin for
// `/board.json` and, when the answer is a Zenit's, connects to that board's WebSocket by itself. The only request is to
// the page's own origin.

import { openWebSocket } from "../protocol/websocket";
import { OpenFailed, type BoardSession, type Opener } from "./session";

export interface ServedBoard {
  hostname: string;
}

/** The hostname of a board: `zenit-` and four lowercase hexadecimal digits (the simulator's bridge reports `zenit-0000`). */
const HOSTNAME = /^zenit-[0-9a-f]{4}$/;
/** The board's answer is about 50 bytes; anything much longer is another page. */
const MAX_BODY = 256;
export const PROBE_TIMEOUT_MS = 2000;

/** The board in `/board.json`, or null unless it is exactly `{"zenit":true,"hostname":"zenit-xxxx","ws":"/ws"}`. */
export function readBoardJson(text: string): ServedBoard | null {
  if (text.length > MAX_BODY) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "hostname,ws,zenit") return null;
  const { zenit, hostname, ws } = value as Record<string, unknown>;
  if (zenit !== true || ws !== "/ws" || typeof hostname !== "string" || !HOSTNAME.test(hostname)) return null;
  return { hostname };
}

export interface ProbeEnvironment {
  protocol: string;
  fetch: typeof fetch;
}

/**
 * Whether this page was served by a board. Only a page loaded over `http:` can be (the board has no HTTPS), and it asks
 * its own origin only. Any failure, a timeout included, means "not served".
 */
export async function probeServed(
  environment: ProbeEnvironment = { protocol: location.protocol, fetch: (...args) => fetch(...args) },
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<ServedBoard | null> {
  if (environment.protocol !== "http:") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await environment.fetch("/board.json", {
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    return response.ok ? readBoardJson(await response.text()) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The opener of the WebSocket of the board that served this page. */
export function servedOpener(host: string): Opener {
  return async () => {
    try {
      return await openWebSocket(`ws://${host}/ws`);
    } catch {
      throw new OpenFailed("Could not reach this Zenit. Check that it is on, and on the same network.");
    }
  };
}

/** Looks for the board that served this page and connects to it. Marks the session as probing until it knows. */
export async function connectServed(
  session: BoardSession,
  environment?: ProbeEnvironment,
  host: string = location.host,
): Promise<void> {
  const served = await probeServed(environment);
  session.setServed(served);
  if (served) await session.open(servedOpener(host), host);
}
