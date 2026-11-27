// SPDX-License-Identifier: GPL-3.0-or-later

import { useCallback, useSyncExternalStore } from "react";
import type { BoardState } from "../board/session";

export type Route = "light" | "device" | "privacy" | "connect";

const ROUTES: readonly Route[] = ["light", "device", "privacy", "connect"];

/** The route in an address fragment such as `#/device`; the Light view for anything else. */
export function routeOf(hash: string): Route {
  const name = hash.replace(/^#\/?/, "");
  return ROUTES.find((route) => route === name) ?? "light";
}

const subscribe = (listener: () => void): (() => void) => {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
};

export function useRoute(): [Route, (route: Route) => void] {
  const route = routeOf(useSyncExternalStore(subscribe, () => window.location.hash));
  const go = useCallback((next: Route) => {
    window.location.hash = `#/${next}`;
  }, []);
  return [route, go];
}

/** What the page shows: the route, and in its place the login or the Connect screen when the connection asks for it. */
export type Screen = "privacy" | "login" | "device" | "connect" | "light";

/**
 * The one screen for a route and a connection phase. The Light view is the front page: without a connection it is the
 * Connect screen. A lost connection keeps its last values on the Light view. A board that waits for a token shows the
 * login in place of the Light and Device views.
 */
export function screenOf(route: Route, phase: BoardState["phase"]): Screen {
  if (route === "privacy") return "privacy";
  if (phase === "login") return "login";
  if (route === "device") return "device";
  if (route === "connect" || phase === "disconnected" || phase === "connecting") return "connect";
  return "light";
}
