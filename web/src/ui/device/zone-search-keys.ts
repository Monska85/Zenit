// SPDX-License-Identifier: GPL-3.0-or-later

// The keys of the time zone search field (docs/web/web-app-v1.md#time-zones), as a pure function the tests run.

/** The state of the suggestion list: open or not, and the option the keys point at (-1 for none). */
export interface ListState {
  open: boolean;
  active: number;
}

/**
 * What a key does in the search field with `count` suggestions: Down and Up move through them (and open the list), Enter
 * chooses the one pointed at, Escape closes the list, or clears the text when it is closed. `handled` keys take no
 * other effect (no caret move, no form submit).
 */
export function zoneSearchKey(
  state: ListState,
  key: string,
  count: number,
): { state: ListState; action: "none" | "choose" | "clear"; handled: boolean } {
  switch (key) {
    case "ArrowDown":
      if (count === 0) return { state, action: "none", handled: true };
      return {
        state: { open: true, active: state.open && state.active >= 0 ? (state.active + 1) % count : 0 },
        action: "none",
        handled: true,
      };
    case "ArrowUp":
      if (count === 0) return { state, action: "none", handled: true };
      return {
        state: { open: true, active: state.open && state.active > 0 ? state.active - 1 : count - 1 },
        action: "none",
        handled: true,
      };
    case "Enter":
      if (state.open && state.active >= 0 && state.active < count) return { state, action: "choose", handled: true };
      return { state, action: "none", handled: state.open };
    case "Escape":
      if (state.open) return { state: { open: false, active: -1 }, action: "none", handled: true };
      return { state, action: "clear", handled: true };
    default:
      return { state, action: "none", handled: false };
  }
}
