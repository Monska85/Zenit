import { defineConfig } from "@playwright/test";
import screenshots from "./playwright.screenshots.config.ts";

// The layout checks of screenshots/layout.spec.ts: every state of the screenshot suite, at 360 px and at desktop width,
// checked without reference images. Text does not need to render like in the container, so this runs on the host with
// the end-to-end tests.
export default defineConfig({
  ...screenshots,
  testMatch: "layout.spec.ts",
  snapshotPathTemplate: undefined,
  outputDir: "test-results-layout",
  reporter: process.env["CI"]
    ? [["list"], ["github"], ["html", { open: "never", outputFolder: "playwright-report-layout" }]]
    : [["list"]],
});
