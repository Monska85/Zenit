// SPDX-License-Identifier: GPL-3.0-or-later

import { useCallback, useSyncExternalStore } from "react";

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
