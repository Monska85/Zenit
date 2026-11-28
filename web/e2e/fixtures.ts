// SPDX-License-Identifier: GPL-3.0-or-later

import { test as base, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const ROOT = join(import.meta.dirname, "..", "..");

export interface Simulator {
  /** The WebSocket address of the simulator's bridge, as a person would type it. */
  url: string;
  /** The `http://` origin of the same port: it serves the built app and /board.json when started with `app`. */
  origin: string;
}

/**
 * Starts the simulator behind tools/ws_bridge.py on a free port and returns its address. With `app` the bridge also
 * serves the built app, as a board does, so a test can open `origin` and let the app find its board.
 */
async function startSimulator(
  app = false,
  control: string | null = null,
): Promise<{ simulator: Simulator; stop: () => void }> {
  const real = process.env["ZENIT_SIM"] ?? join(ROOT, ".pio", "build", "native", "program");
  if (!existsSync(real)) throw new Error(`no simulator at ${real}: run \`just sim-build\``);
  // With a control file the bridge runs e2e/sim-control.py, which runs the simulator and sends it the file's lines
  const sim = control === null ? real : join(import.meta.dirname, "sim-control.py");
  const bridge = process.env["ZENIT_WS_BRIDGE"] ?? join(ROOT, "tools", "ws_bridge.py");
  const dist = join(ROOT, "web", "dist");
  if (app && !existsSync(join(dist, "index.html"))) throw new Error(`no built app at ${dist}: run \`just web-build\``);
  const args = [bridge, "--sim", sim, "--port", "0", ...(app ? ["--app", dist] : [])];
  const child: ChildProcess = spawn(process.env["ZENIT_PYTHON"] ?? "python3", args, {
    stdio: ["ignore", "pipe", "inherit"],
    env: control === null ? process.env : { ...process.env, ZENIT_REAL_SIM: real, ZENIT_SIM_CONTROL: control },
  });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the simulator's bridge did not start in time")), 15_000);
    child.once("exit", (code) => reject(new Error(`the simulator's bridge stopped with status ${code}`)));
    createInterface({ input: child.stdout! }).on("line", (line) => {
      const match = /^listening (ws:\/\/\S+)/.exec(line);
      if (match) {
        clearTimeout(timer);
        resolve(match[1] as string);
      }
    });
  });
  return {
    simulator: { url, origin: url.replace(/^ws:/, "http:") },
    stop: () => void child.kill("SIGTERM"),
  };
}

/** A simulator that a test can send control lines (`!restart`: the board starts again, as after a power cut). */
export interface ControlledSimulator extends Simulator {
  /** Sends the control line and returns once the simulator has it: every request made after it is read after it. */
  control: (line: string) => Promise<void>;
}

export const test = base.extend<{
  simulator: Simulator;
  servedSimulator: Simulator;
  controlledSimulator: ControlledSimulator;
}>({
  // eslint-disable-next-line no-empty-pattern
  controlledSimulator: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), "zenit-sim-"));
    const file = join(dir, "control");
    writeFileSync(file, "");
    const { simulator, stop } = await startSimulator(false, file);
    try {
      await use({
        ...simulator,
        control: async (line) => {
          appendFileSync(file, `${line}\n`);
          await expect.poll(() => readFileSync(file, "utf8"), { timeout: 5000 }).toBe("");
        },
      });
    } finally {
      stop();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  // eslint-disable-next-line no-empty-pattern
  simulator: async ({}, use) => {
    const { simulator, stop } = await startSimulator();
    try {
      await use(simulator);
    } finally {
      stop();
    }
  },
  // The simulator's bridge serving the built app too: a page opened from its origin finds the board by itself
  // eslint-disable-next-line no-empty-pattern
  servedSimulator: async ({}, use) => {
    const { simulator, stop } = await startSimulator(true);
    try {
      await use(simulator);
    } finally {
      stop();
    }
  },
});

export { expect };

/** Opens the app and connects it to a board by address. */
export async function connectByAddress(page: Page, url: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Address of your Zenit").fill(url);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Connection: WiFi/ })).toBeVisible();
}

/**
 * Collects the errors of the page's console and the page's own script errors. A page loaded over plain `http://` asks its
 * own origin for `/board.json` to find out whether a board served it, and a site that is not a board answers 404, which the
 * browser logs as an error of its own: that one request is not an error of the app.
 */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url.endsWith("/board.json")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}
