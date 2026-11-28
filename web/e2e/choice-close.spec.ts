// SPDX-License-Identifier: GPL-3.0-or-later

// A choice survives the page closing right after it: the app sends a choice at once, also while a status poll waits for
// its reply, so a person who picks a value and closes the tab finds it on the board the next time.

import type { Browser, Page } from "@playwright/test";
import { expect, test, type Simulator } from "./fixtures.ts";

/** What the page's hold script shares with the test. */
type HoldWindow = Window & { zenitHold: { armed: boolean; holding: boolean } };

/** Opens the page the board serves, on `hash`, connected. */
async function openServed(browser: Browser, simulator: Simulator, hash = ""): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`${simulator.origin}/${hash}`);
  await expect(page.getByRole("button", { name: /^Connection: WiFi/ })).toBeVisible();
  return page;
}

/** Opens the folded Advanced settings of the Device page. */
async function openAdvanced(page: Page): Promise<void> {
  await page.getByText("Advanced settings", { exact: true }).click();
  await expect(page.getByRole("region", { name: "Update settings" })).toBeVisible();
}

const LISTS = [
  { label: "WiFi strength", value: "13", advanced: false },
  { label: "Look for updates", value: "3", advanced: true },
  { label: "Check the time", value: "24", advanced: true },
  { label: "Time zone", value: "CET-1CEST,M3.5.0,M10.5.0/3", advanced: true },
];

for (const list of LISTS) {
  test(`keeps "${list.label}" chosen from the list when the page closes at once`, async ({
    browser,
    servedSimulator,
  }) => {
    const page = await openServed(browser, servedSimulator, "#/device");
    if (list.advanced) await openAdvanced(page);
    const field = page.getByLabel(list.label, { exact: true });
    await expect(field).toBeEnabled();
    expect(await field.inputValue()).not.toBe(list.value);
    await field.selectOption(list.value);
    await page.close();

    const next = await openServed(browser, servedSimulator, "#/device");
    if (list.advanced) await openAdvanced(next);
    await expect(next.getByLabel(list.label, { exact: true })).toHaveValue(list.value);
    await next.close();
  });
}

test("keeps an effect chosen on the Light page when the page closes at once", async ({ browser, servedSimulator }) => {
  const page = await openServed(browser, servedSimulator);
  await expect(page.getByRole("radio", { name: "Steady" })).toBeChecked();
  await page.getByRole("radio", { name: "Breathing", exact: true }).check({ force: true });
  await page.close();

  const next = await openServed(browser, servedSimulator);
  await expect(next.getByRole("radio", { name: "Breathing", exact: true })).toBeChecked();
  await next.close();
});

test("keeps a choice made while a status reply is on its way when the page closes at once", async ({
  browser,
  servedSimulator,
}) => {
  const page = await browser.newPage();
  // Once armed, the app stops hearing the board when its next status leaves: that poll waits for a reply that is on its
  // way, as over WiFi, where the reply takes 100 to 200 ms
  await page.addInitScript(() => {
    const state = { armed: false, holding: false };
    (window as unknown as HoldWindow).zenitHold = state;
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (state.armed && !state.holding && String(data).includes('"cmd":"status"')) state.holding = true;
      send.call(this, data);
    };
    const handler = Object.getOwnPropertyDescriptor(WebSocket.prototype, "onmessage")!;
    Object.defineProperty(WebSocket.prototype, "onmessage", {
      ...handler,
      set(listener: ((event: MessageEvent) => void) | null) {
        handler.set!.call(this, listener && ((event: MessageEvent) => state.holding || listener.call(this, event)));
      },
    });
  });
  await page.goto(`${servedSimulator.origin}/#/device`);
  await expect(page.getByRole("button", { name: /^Connection: WiFi/ })).toBeVisible();
  await openAdvanced(page);
  const field = page.getByLabel("Check the time", { exact: true });
  await expect(field).toHaveValue("6");
  await page.evaluate(() => ((window as unknown as HoldWindow).zenitHold.armed = true));
  await page.waitForFunction(() => (window as unknown as HoldWindow).zenitHold.holding);
  await field.selectOption("24");
  await page.close();

  const next = await openServed(browser, servedSimulator, "#/device");
  await openAdvanced(next);
  await expect(next.getByLabel("Check the time", { exact: true })).toHaveValue("24");
  await next.close();
});
