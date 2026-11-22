import { defineConfig } from "@playwright/test";
import { workers } from "./playwright.workers.ts";

const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  // `make` and `just` set ZENIT_JOBS (JOBS) for the workers.
  workers: workers(process.env["ZENIT_JOBS"]),
  fullyParallel: true,
  timeout: 60_000,
  reporter: process.env["CI"] ? [["list"], ["github"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: "chromium",
    trace: process.env["CI"] ? "retain-on-failure" : "off",
  },
  // Serves the built app (just web-build first) with a fixture firmware release next to it, as Pages would. The
  // simulator's bridge allows http://localhost:* as an origin.
  webServer: {
    command: "node e2e/serve-site.mjs",
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}`,
    timeout: 30_000,
  },
});
