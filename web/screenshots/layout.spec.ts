// SPDX-License-Identifier: GPL-3.0-or-later

// Every state of states.ts, at the phone width (360 px) and at desktop width, in both themes, checked without
// reference images: the page does not scroll sideways, nothing reaches outside the window, every control is at least 44
// px high and has an accessible name, and no text is cut by its box. A failure names the element that broke the rule.

import { expect, test } from "@playwright/test";
import { layoutProblems } from "./layout.ts";
import { STATES, THEMES, WIDTHS } from "./states.ts";

for (const state of STATES) {
  test.describe(() => {
    test.use({ timezoneId: state.timezoneId ?? "UTC", locale: state.locale ?? "en-GB" });
    for (const size of WIDTHS) {
      for (const theme of THEMES) {
        test(`${state.name} at ${size.width} px, ${theme} theme`, async ({ page }) => {
          await page.setViewportSize({ width: size.width, height: size.height });
          await page.emulateMedia({ colorScheme: theme });
          await state.reach(page);
          expect(await layoutProblems(page)).toEqual([]);
        });
      }
    }
  });
}
