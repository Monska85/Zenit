// SPDX-License-Identifier: GPL-3.0-or-later

import type { Page } from "@playwright/test";
import { connectByAddress, expect, test } from "./fixtures.ts";

/** Presses a slider thumb, drags it to a fraction of the slider's width, and lets go. */
async function dragTo(page: Page, name: string, fraction: number): Promise<void> {
  const thumb = page.getByRole("slider", { name });
  const root = thumb.locator("xpath=ancestor::span[contains(@class, 'touch-none')]");
  const box = (await root.boundingBox())!;
  const handle = (await thumb.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

/** The `settings_set` lines the page sent to the simulator in this test. */
let saves: string[] = [];

test.beforeEach(async ({ page, simulator }) => {
  saves = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      if (typeof frame.payload === "string" && frame.payload.includes('"cmd":"settings_set"'))
        saves.push(frame.payload);
    }),
  );
  await connectByAddress(page, simulator.url);
});

test("shows the default light: on, 60 %, steady, no timer", async ({ page }) => {
  await expect(page.getByTestId("power-button")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("slider", { name: "Brightness" })).toHaveAttribute("aria-valuenow", "60");
  await expect(page.getByRole("radio", { name: "Steady" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Off", exact: true })).toBeChecked();
  await expect(page.getByTestId("live-color")).toHaveText("Warm white");
  await expect(page.getByTestId("live-effect")).toHaveText("Steady");
});

test("turns the light off and on, and the state follows the board", async ({ page }) => {
  const power = page.getByRole("button", { name: "Light", exact: true });
  await expect(power).toHaveAttribute("aria-pressed", "true");
  await power.click();
  await expect(power).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("power-button")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("live-state")).toHaveText("Off");
  await power.click();
  await expect(page.getByTestId("power-button")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("live-color")).toHaveText("Warm white");
});

test("sends the brightness when the slider is released and keeps it", async ({ page }) => {
  await dragTo(page, "Brightness", 0.2);
  const value = await page.getByRole("slider", { name: "Brightness" }).getAttribute("aria-valuenow");
  expect(Number(value)).toBeGreaterThan(10);
  expect(Number(value)).toBeLessThan(30);
  // the board kept it: a new connection reads it back
  await page.getByRole("button", { name: /^Connection:/ }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page
    .getByTestId("last-board")
    .getByRole("button", { name: /^Connect to / })
    .click();
  await expect(page.getByRole("slider", { name: "Brightness" })).toHaveAttribute("aria-valuenow", value!);
});

test("sends a slider moved with the keyboard after a pause", async ({ page }) => {
  const slider = page.getByRole("slider", { name: "Brightness" });
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuenow", "57");
  // nothing is sent while the keys are still being pressed: the pause after the last one sends it, once
  expect(saves).toHaveLength(0);
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0]).toContain('"brightness":57');
  await page.getByRole("button", { name: /^Connection:/ }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page
    .getByTestId("last-board")
    .getByRole("button", { name: /^Connect to / })
    .click();
  await expect(page.getByRole("slider", { name: "Brightness" })).toHaveAttribute("aria-valuenow", "57");
});

const EFFECT_SETTINGS: Array<[string, string[]]> = [
  ["Steady", ["Color"]],
  ["Color change", ["Colors", "Time on each color", "Dimmest level"]],
  ["Breathing", ["Color", "Length of a breath", "Dimmest level"]],
  ["Twinkle", ["Color", "Twinkle strength"]],
  ["Fall asleep", ["Color", "Dimmest level"]],
  ["Christmas", ["Palette", "Time on each color", "Dimmest level"]],
];
const ALL_SETTINGS = [
  "Color",
  "Colors",
  "Palette",
  "Time on each color",
  "Length of a breath",
  "Dimmest level",
  "Twinkle strength",
];

for (const [effect, shown] of EFFECT_SETTINGS) {
  test(`${effect}: shows only the settings it reads`, async ({ page }) => {
    await page.getByRole("radio", { name: effect, exact: true }).check({ force: true });
    const settings = page.getByTestId("effect-settings");
    await expect(page.getByTestId("live-effect")).toHaveText(effect);
    for (const name of ALL_SETTINGS) {
      const control = settings
        .getByRole("group", { name, exact: true })
        .or(settings.getByRole("slider", { name, exact: true }));
      if (shown.includes(name)) await expect(control, name).toHaveCount(1);
      else await expect(control, name).toHaveCount(0);
    }
    await expect(settings.getByTestId("newer-effect")).toHaveCount(0);
  });
}

test("keeps the effect after a reconnect", async ({ page }) => {
  await page.getByRole("radio", { name: "Twinkle" }).check({ force: true });
  await expect(page.getByTestId("live-effect")).toHaveText("Twinkle");
  await page.getByRole("button", { name: /^Connection:/ }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page
    .getByTestId("last-board")
    .getByRole("button", { name: /^Connect to / })
    .click();
  await expect(page.getByRole("radio", { name: "Twinkle" })).toBeChecked();
});

test("changes the color of the steady light", async ({ page }) => {
  await page.getByRole("radio", { name: "Blue" }).check({ force: true });
  await expect(page.getByTestId("live-color")).toHaveText("Blue");
  await page.getByRole("radio", { name: "Red" }).check({ force: true });
  await expect(page.getByTestId("live-color")).toHaveText("Red");
});

test("picks the colors of the color change in order, two to four", async ({ page }) => {
  await page.getByRole("radio", { name: "Color change" }).check({ force: true });
  // the default is red, green, blue, white: drop two, then add one back at the end
  await page.getByRole("checkbox", { name: /^Red/ }).uncheck({ force: true });
  await page.getByRole("checkbox", { name: /^Green/ }).uncheck({ force: true });
  await expect(page.getByRole("checkbox", { name: "Blue, number 1" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Warm white, number 2" })).toBeChecked();
  // two are the least: the last ones cannot be dropped
  await page
    .getByRole("checkbox", { name: /^Blue/ })
    .uncheck({ force: true })
    .catch(() => undefined);
  await expect(page.getByRole("checkbox", { name: /^Blue/ })).toBeChecked();
  await page.getByRole("checkbox", { name: "Red" }).check({ force: true });
  await expect(page.getByRole("checkbox", { name: "Red, number 3" })).toBeChecked();
});

test("sets the time on each color from its slider", async ({ page }) => {
  await page.getByRole("radio", { name: "Christmas" }).check({ force: true });
  await page.getByRole("radio", { name: /^Ice/ }).check({ force: true });
  await dragTo(page, "Time on each color", 0.05);
  await expect(page.getByRole("slider", { name: "Time on each color" })).not.toHaveAttribute("aria-valuenow", "30");
  const text = await page.getByRole("slider", { name: "Time on each color" }).getAttribute("aria-valuetext");
  expect(text).toMatch(/^(\d+ s|\d+ min( \d+ s)?)$/);
});

test("shows a hint on Fall asleep while there is no timer", async ({ page }) => {
  await page.getByRole("radio", { name: "Fall asleep" }).check({ force: true });
  await expect(page.getByText("This effect dims while the sleep timer runs.")).toBeVisible();
  await page.getByRole("radio", { name: "30 min" }).check({ force: true });
  await expect(page.getByText("This effect dims while the sleep timer runs.")).toHaveCount(0);
});

test("starts and stops the sleep timer and shows the time left", async ({ page }) => {
  await page.getByRole("radio", { name: "30 min" }).check({ force: true });
  await expect(page.getByTestId("timer-line")).toHaveText(/^Fades out in (29|30) min\.$/);
  await expect(page.getByTestId("live-state")).toContainText(/fades out in (29|30) min/);
  await page.getByRole("radio", { name: "Off", exact: true }).check({ force: true });
  // Nothing to say: no line, and no gap where it was
  await expect(page.getByTestId("timer-line")).toHaveCount(0);
  await expect(page.getByTestId("live-state")).not.toContainText("fades out");
});

test("sets a custom timer, and refuses a number outside 1 to 360", async ({ page }) => {
  await page.getByRole("radio", { name: "Custom" }).check({ force: true });
  const field = page.getByLabel("Minutes (1 to 360)");
  for (const bad of ["0", "361", "abc", "1.5", ""]) {
    await field.fill(bad);
    await page.getByRole("button", { name: "Set" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Choose a whole number" })).toBeVisible();
  }
  await field.fill("45");
  await page.getByRole("button", { name: "Set" }).click();
  await expect(page.getByTestId("timer-line")).toHaveText(/^Fades out in (44|45) min\.$/);
  // The chip says the value it holds
  await expect(page.getByRole("radio", { name: "Custom · 45 min" })).toBeChecked();
  // a preset is not custom
  await page.getByRole("radio", { name: "1 h" }).check({ force: true });
  await expect(page.getByRole("radio", { name: "Custom", exact: true })).not.toBeChecked();
  await expect(page.getByLabel("Minutes (1 to 360)")).toHaveCount(0);
});

test("the Device view shows the device and says a reset needs USB", async ({ page }) => {
  await page.getByRole("link", { name: "Device" }).click();
  await expect(page.getByRole("heading", { name: "Your Zenit" })).toBeVisible();
  await page.getByText("Details for technicians").click();
  await expect(page.getByText("simulator", { exact: true })).toBeVisible();
  await expect(page.getByText("1 W", { exact: true })).toBeVisible();
  await expect(page.getByText("Resetting needs a USB cable.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset to defaults" })).toHaveCount(0);
});
