// SPDX-License-Identifier: GPL-3.0-or-later

// A page served by the board itself (docs/board/wifi-and-updates-v1.md#the-served-web-app): it asks its own origin for
// `/board.json` and, when the answer is a Zenit's, connects to that board's WebSocket by itself. The only request is to
// the page's own origin.

import { parseStrictObject } from "../protocol/strict-json";
import { openWebSocket } from "../protocol/websocket";
import { message } from "../i18n";
import { OpenFailed, type BoardSession, type Opener } from "./session";

export interface ServedBoard {
  hostname: string;
}

/** The hostname of a board: `zenit-` and four lowercase hexadecimal digits (the simulator's bridge reports `zenit-0000`). */
const HOSTNAME = /^zenit-[0-9a-f]{4}$/;
/** The board's answer is about 50 bytes; anything much longer is another page. */
const MAX_BODY = 256;
const PROBE_TIMEOUT_MS = 2000;

/**
 * The board in the bytes of `/board.json`, or null unless they are strict JSON of at most 256 bytes and exactly
 * `{"zenit":true,"hostname":"zenit-xxxx","ws":"/ws"}`.
 */
export function readBoardJson(body: Uint8Array): ServedBoard | null {
  if (body.length > MAX_BODY) return null;
  let value: Record<string, unknown>;
  try {
    value = parseStrictObject(body);
  } catch {
    return null;
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "hostname,ws,zenit") return null;
  const { zenit, hostname, ws } = value;
  if (zenit !== true || ws !== "/ws" || typeof hostname !== "string" || !HOSTNAME.test(hostname)) return null;
  return { hostname };
}

/** The bytes of `stream`, or null once it passes `limit`: a long answer is not read to its end. */
async function readAtMost(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) return null;
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
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
    if (!response.ok || response.body === null) return null;
    const body = await readAtMost(response.body, MAX_BODY + 1);
    return body === null ? null : readBoardJson(body);
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
      throw new OpenFailed(message("errors:open.servedUnreachable"));
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
