// SPDX-License-Identifier: GPL-3.0-or-later

import { test as base, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const ROOT = join(import.meta.dirname, "..", "..");

export interface Simulator {
  /** The WebSocket address of the simulator's bridge, as a person would type it. */
  url: string;
}

/** Starts the simulator behind tools/ws_bridge.py on a free port and returns its address. */
async function startSimulator(): Promise<{ simulator: Simulator; stop: () => void }> {
  const sim = process.env["ZENIT_SIM"] ?? join(ROOT, ".pio", "build", "native", "program");
  if (!existsSync(sim)) throw new Error(`no simulator at ${sim}: run \`just sim-build\``);
  const bridge = process.env["ZENIT_WS_BRIDGE"] ?? join(ROOT, "tools", "ws_bridge.py");
  const child: ChildProcess = spawn(process.env["ZENIT_PYTHON"] ?? "python3", [bridge, "--sim", sim, "--port", "0"], {
    stdio: ["ignore", "pipe", "inherit"],
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
  return { simulator: { url }, stop: () => void child.kill("SIGTERM") };
}

export const test = base.extend<{ simulator: Simulator }>({
  // eslint-disable-next-line no-empty-pattern
  simulator: async ({}, use) => {
    const { simulator, stop } = await startSimulator();
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
  await expect(page.getByTestId("connection")).toContainText("Connected");
}
