// SPDX-License-Identifier: GPL-3.0-or-later

// One reference image per state of states.ts, at the phone and at the desktop width, in the light theme, and in the dark
// theme for the states marked `dark`. They are only comparable when drawn by the same browser build and fonts, so
// `just web-screenshots` runs this inside the Playwright container.

import { expect, test } from "@playwright/test";
import { STATES, THEMES, WIDTHS } from "./states.ts";

for (const state of STATES) {
  test.describe(() => {
    test.use({ timezoneId: state.timezoneId ?? "UTC", locale: state.locale ?? "en-GB" });
    for (const size of WIDTHS) {
      if (state.phoneOnly && size.name !== "phone") continue;
      for (const theme of THEMES) {
        if (theme === "dark" && !state.dark) continue;
        test(`${state.name} at ${size.width} px, ${theme} theme`, async ({ page }) => {
          await page.setViewportSize({ width: size.width, height: size.height });
          await page.emulateMedia({ colorScheme: theme });
          await state.reach(page);
          // Let the last transition and the focus settle, and take no hover from the pointer
          await page.mouse.move(0, 0);
          // A window as tall as the page, rather than a full-page capture: what is fixed to the bottom of the window (the
          // tab bar of a phone, a message) is drawn at the bottom of the image, not where the first screen ended
          const height = await page.evaluate(() => document.documentElement.scrollHeight);
          await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
          await expect(page).toHaveScreenshot(`${state.name}-${size.name}-${theme}.png`, {
            mask: state.mask?.(page) ?? [],
          });
        });
      }
    }
  });
}
