// SPDX-License-Identifier: GPL-3.0-or-later

// One reference image per state of states.ts, at the phone and at the desktop width, in the light theme, and in the dark
// theme for the states marked `dark`. They are only comparable when drawn by the same browser build and fonts, so
// `just web-screenshots` runs this inside the Playwright container.

import { expect, test } from "@playwright/test";
import { STATES, THEMES, WIDTHS } from "./states.ts";

for (const state of STATES) {
  for (const size of WIDTHS) {
    for (const theme of THEMES) {
      if (theme === "dark" && !state.dark) continue;
      test(`${state.name} at ${size.width} px, ${theme} theme`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.emulateMedia({ colorScheme: theme });
        await state.reach(page);
        // Let the last transition and the focus settle, and take no hover from the pointer
        await page.mouse.move(0, 0);
        await expect(page).toHaveScreenshot(`${state.name}-${size.name}-${theme}.png`, {
          fullPage: true,
          mask: state.mask?.(page) ?? [],
        });
      });
    }
  }
}
