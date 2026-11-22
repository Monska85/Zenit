import { defineConfig } from "@playwright/test";
import { workers } from "./playwright.workers.ts";

const PORT = 4174;

// Compares one image per state, view, width and theme (screenshots/views.spec.ts) with the reference images in
// screenshots/baselines/. Text is only drawn the same way by the same browser build and fonts, so `just
// web-screenshots` runs this suite in the official Playwright container (see README.md). Run without the container,
// text renders differently and the comparisons fail.
export default defineConfig({
  testDir: "screenshots",
  testMatch: "views.spec.ts",
  snapshotPathTemplate: "{testDir}/baselines/{arg}{ext}",
  workers: workers(process.env["ZENIT_JOBS"]),
  fullyParallel: true,
  timeout: 60_000,
  reporter: process.env["CI"]
    ? [["list"], ["github"], ["html", { open: "never", outputFolder: "playwright-report-screenshots" }]]
    : [["list"]],
  outputDir: "test-results-screenshots",
  expect: {
    // No tolerance beyond the comparison's own color threshold: the container draws the same text every time, and a
    // share of a long page would hide a control 76 px out of place.
    toHaveScreenshot: { animations: "disabled", caret: "hide" },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: "chromium",
    // The same text everywhere: language, time zone and screen density.
    locale: "en-GB",
    timezoneId: "UTC",
    deviceScaleFactor: 1,
    contextOptions: { reducedMotion: "reduce" },
    trace: process.env["CI"] ? "retain-on-failure" : "off",
  },
  webServer: {
    command: "node e2e/serve-site.mjs",
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}`,
    timeout: 30_000,
  },
});
