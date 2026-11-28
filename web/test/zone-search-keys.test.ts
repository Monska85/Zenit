// SPDX-License-Identifier: GPL-3.0-or-later

// The keys of the time zone search field (docs/web/web-app-v1.md#time-zones).

import { describe, expect, it } from "vitest";
import { zoneSearchKey, type ListState } from "../src/ui/device/zone-search-keys";

describe("zoneSearchKey", () => {
  const closed: ListState = { open: false, active: -1 };
  const at = (active: number): ListState => ({ open: true, active });

  it("moves down and up through the suggestions, around the ends, and opens the list", () => {
    expect(zoneSearchKey(closed, "ArrowDown", 3).state).toEqual(at(0));
    expect(zoneSearchKey(at(-1), "ArrowDown", 3).state).toEqual(at(0));
    expect(zoneSearchKey(at(0), "ArrowDown", 3).state).toEqual(at(1));
    expect(zoneSearchKey(at(2), "ArrowDown", 3).state).toEqual(at(0));
    expect(zoneSearchKey(closed, "ArrowUp", 3).state).toEqual(at(2));
    expect(zoneSearchKey(at(0), "ArrowUp", 3).state).toEqual(at(2));
    expect(zoneSearchKey(at(2), "ArrowUp", 3).state).toEqual(at(1));
    expect(zoneSearchKey(at(1), "ArrowDown", 3).handled).toBe(true);
  });

  it("does nothing with no suggestions", () => {
    expect(zoneSearchKey(closed, "ArrowDown", 0)).toEqual({ state: closed, action: "none", handled: true });
    expect(zoneSearchKey(closed, "Enter", 0)).toEqual({ state: closed, action: "none", handled: false });
  });

  it("chooses the suggestion pointed at with Enter, and nothing when none is", () => {
    expect(zoneSearchKey(at(1), "Enter", 3).action).toBe("choose");
    expect(zoneSearchKey(at(-1), "Enter", 3)).toEqual({ state: at(-1), action: "none", handled: true });
    expect(zoneSearchKey(at(5), "Enter", 3).action).toBe("none");
  });

  it("closes the list with Escape, then clears the text", () => {
    expect(zoneSearchKey(at(1), "Escape", 3)).toEqual({ state: closed, action: "none", handled: true });
    expect(zoneSearchKey(closed, "Escape", 3)).toEqual({ state: closed, action: "clear", handled: true });
  });

  it("leaves every other key to the field", () => {
    for (const key of ["a", "Tab", "Home", "Backspace"])
      expect(zoneSearchKey(at(1), key, 3)).toEqual({ state: at(1), action: "none", handled: false });
  });
});
