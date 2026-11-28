// SPDX-License-Identifier: GPL-3.0-or-later

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { MOCK_URL, mockBoard, type Mock } from "./mock-board.ts";

// The board is played by a script, so it can refuse and fall silent.

async function connect(page: Page): Promise<Mock> {
  const mock = await mockBoard(page);
  await page.goto("/");
  await page.getByLabel("Address of your Zenit").fill(MOCK_URL);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Connection: (WiFi|USB)/ })).toBeVisible();
  return mock;
}

test("sends a setting only when the slider is released", async ({ page }) => {
  const mock = await connect(page);
  const thumb = page.getByRole("slider", { name: "Brightness" });
  const handle = (await thumb.boundingBox())!;
  const root = (await thumb.locator("xpath=ancestor::span[contains(@class, 'touch-none')]").boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(root.x + root.width * 0.3, root.y + root.height / 2, { steps: 10 });
  // The slider shows the value being chosen, and nothing has been sent for it
  await expect(thumb).not.toHaveAttribute("aria-valuenow", "60");
  expect(mock.commands().filter((command) => command === "settings_set")).toHaveLength(0);
  await page.mouse.up();
  await expect.poll(() => mock.commands().filter((command) => command === "settings_set")).toHaveLength(1);
  const sent = mock.board.requests.filter((request) => request["cmd"] === "settings_set")[0]!;
  expect(Object.keys(sent).sort()).toEqual(["brightness", "cmd", "seq"]);
});

test("sends each choice as one setting, and only that", async ({ page }) => {
  const mock = await connect(page);
  await page.getByRole("radio", { name: "Breathing", exact: true }).check({ force: true });
  await expect.poll(() => mock.board.requests.filter((request) => request["cmd"] === "settings_set")).toHaveLength(1);
  const sent = mock.board.requests.filter((request) => request["cmd"] === "settings_set");
  expect(sent[0]).toMatchObject({ effect: "breathing" });
  expect(Object.keys(sent[0]!).sort()).toEqual(["cmd", "effect", "seq"]);
});

test("asks the board for its status every second while the page is visible", async ({ page }) => {
  const mock = await connect(page);
  const before = mock.commands().filter((command) => command === "status").length;
  await expect
    .poll(() => mock.commands().filter((command) => command === "status").length, { timeout: 5000 })
    .toBeGreaterThan(before + 1);
});

test("shows what the board holds, with a sentence, when it refuses a value", async ({ page }) => {
  const mock = await connect(page);
  mock.board.errors.set("settings_set", "bad_request");
  await page.getByRole("radio", { name: "Breathing", exact: true }).check({ force: true });
  await expect(page.getByRole("alert")).toHaveText("Zenit did not accept that value.");
  await expect(page.getByRole("radio", { name: "Steady" })).toBeChecked();
  await page.getByRole("button", { name: "Close this message" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("shows an error at the bottom of the screen, where a phone user is looking", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 });
  const mock = await connect(page);
  mock.board.errors.set("settings_set", "bad_request");
  await page.getByRole("radio", { name: "Christmas" }).check({ force: true });
  const message = page.getByTestId("bottom-message");
  await expect(message).toHaveRole("alert");
  await expect(message).toHaveText("Zenit did not accept that value.");
  // Anchored above the tab bar, whatever the scroll
  const box = (await message.boundingBox())!;
  const nav = (await page.getByRole("navigation", { name: "Pages" }).boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(nav.y);
  expect(box.y).toBeGreaterThan(700 / 2);
  await page.mouse.wheel(0, 600);
  expect((await message.boundingBox())!.y).toBeCloseTo(box.y, 0);
  await message.getByRole("button", { name: "Close this message" }).click();
  await expect(message).toHaveCount(0);
});

test("says a value could not be saved, without showing the board's own message", async ({ page }) => {
  const mock = await connect(page);
  mock.board.errors.set("settings_set", "storage_error");
  await page.getByRole("radio", { name: "Twinkle" }).check({ force: true });
  await expect(page.getByRole("alert")).toHaveText("Zenit could not save that. Nothing was changed.");
  await expect(page.getByText("for logs")).toHaveCount(0);
});

test("clears the error with the next request that works", async ({ page }) => {
  const mock = await connect(page);
  mock.board.errors.set("settings_set", "busy");
  await page.getByRole("radio", { name: "Twinkle" }).check({ force: true });
  await expect(page.getByRole("alert")).toContainText("busy");
  mock.board.errors.delete("settings_set");
  await page.getByRole("radio", { name: "Twinkle" }).check({ force: true });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("live-effect")).toHaveText("Twinkle");
});

test("keeps the last values greyed and disabled when the board stops answering", async ({ page }) => {
  const mock = await connect(page);
  mock.board.silent = true;
  await expect(page.getByTestId("connection-lost")).toBeVisible({ timeout: 25_000 });
  // One message for one problem: the reason, the last values and Reconnect, in one banner
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByRole("alert")).toContainText("Zenit did not answer");
  await expect(page.getByTestId("bottom-message")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reconnect" })).toHaveCount(1);
  await expect(page.getByTestId("connection-lost").getByRole("button", { name: "Reconnect" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Connection: Not connected" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Brightness" })).toHaveAttribute("aria-valuenow", "60");
});

test("keeps the lost banner and Reconnect on the Privacy page, and says the reason once", async ({ page }) => {
  const mock = await connect(page);
  mock.board.silent = true;
  await expect(page.getByTestId("connection-lost")).toBeVisible({ timeout: 25_000 });
  await page.getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy", level: 1 })).toBeVisible();
  await expect(page.getByTestId("connection-lost").getByRole("button", { name: "Reconnect" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByTestId("bottom-message")).toHaveCount(0);
});

test("shows the last values, disabled, after the link drops, and reconnects to the same address", async ({ page }) => {
  const mock = await connect(page);
  await page.getByRole("radio", { name: "Twinkle" }).check({ force: true });
  await expect(page.getByTestId("live-effect")).toHaveText("Twinkle");
  mock.drop();
  await expect(page.getByTestId("connection-lost")).toBeVisible({ timeout: 10_000 });
  // The Light view stays, greyed, with the last values: no Connect screen
  await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Light", exact: true })).toBeDisabled();
  await expect(page.getByRole("slider", { name: "Brightness" })).toHaveAttribute("data-disabled", "");
  await expect(page.getByRole("radio", { name: "Steady" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "Twinkle" })).toBeChecked();
  await expect(page.getByTestId("connection-lost")).toContainText("Connection lost.");
  await expect(page.getByTestId("connection-lost")).toContainText("These are the last values Zenit reported.");
  await expect(page.getByRole("alert")).toHaveCount(1);
  // Reconnect opens the same address again, with nothing typed
  const before = mock.commands().filter((command) => command === "info").length;
  await page.getByRole("button", { name: "Reconnect" }).click();
  await expect(page.getByTestId("connection")).toContainText("WiFi");
  expect(mock.commands().filter((command) => command === "info").length).toBe(before + 1);
  await expect(page.getByRole("button", { name: "Light", exact: true })).toBeEnabled();
  await expect(page.getByRole("radio", { name: "Twinkle" })).toBeChecked();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("connection-lost")).toHaveCount(0);
  // A short confirmation, read by a screen reader, that goes by itself
  await expect(page.getByTestId("bottom-message")).toHaveText("Connected again.");
  await expect(page.getByRole("status").filter({ hasText: "Connected again." })).toHaveCount(1);
  await expect(page.getByTestId("bottom-message")).toHaveCount(0, { timeout: 10_000 });
});

test("sends one save for a run of key presses after a click that changed nothing", async ({ page }) => {
  const mock = await connect(page);
  const thumb = page.getByRole("slider", { name: "Brightness" });
  // A click on the thumb without moving it changes nothing, so the slider reports no commit for it
  await thumb.click();
  await thumb.press("ArrowLeft");
  await thumb.press("ArrowLeft");
  await thumb.press("ArrowLeft");
  await expect(thumb).toHaveAttribute("aria-valuenow", "57");
  const sent = () => mock.board.requests.filter((request) => request["cmd"] === "settings_set");
  await expect.poll(() => sent().length).toBe(1);
  expect(sent()[0]).toMatchObject({ brightness: 57 });
});

test("keeps showing the last choice while an earlier one is answered late", async ({ page }) => {
  const mock = await connect(page);
  // The board takes 600 ms for the first save and 2.5 s for the second
  let saves = 0;
  let firstAnswered = false;
  mock.delay = (request) => {
    if (request["cmd"] !== "settings_set") return 0;
    if (saves++ > 0) return 2500;
    setTimeout(() => (firstAnswered = true), 650);
    return 600;
  };
  await page.getByRole("radio", { name: "Breathing", exact: true }).check({ force: true });
  await page.getByRole("radio", { name: "Twinkle" }).check({ force: true });
  // After the first answer, the second is still on its way: the choice on screen is the second
  await expect.poll(() => mock.board.settings["effect"], { timeout: 5000 }).toBe("twinkle");
  await expect.poll(() => firstAnswered).toBe(true);
  await expect(page.getByRole("radio", { name: "Twinkle" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Breathing", exact: true })).not.toBeChecked();
  await expect(page.getByTestId("live-effect")).toHaveText("Twinkle", { timeout: 5000 });
});

test("offers an effect it does not know, as a plain card and a line in place of its settings", async ({ page }) => {
  const mock = await mockBoard(page);
  const answer = mock.board.answer;
  mock.board.answer = (request) =>
    answer(request).map((reply) =>
      request["cmd"] === "info" ? { ...reply, effects: [...(reply["effects"] as string[]), "northern_lights"] } : reply,
    );
  await page.goto("/");
  await page.getByLabel("Address of your Zenit").fill(MOCK_URL);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const card = page.getByRole("radio", { name: "Northern lights" });
  await expect(card).toBeVisible();
  await card.check({ force: true });
  await expect(page.getByTestId("live-effect")).toHaveText("Northern lights");
  await expect(page.getByTestId("effect-settings").locator("input, [role=slider]")).toHaveCount(0);
  await expect(page.getByTestId("newer-effect")).toHaveText(
    "This Zenit has a newer effect. Update the app to adjust its settings.",
  );
});

/** Connects to a scripted board whose `info` reports `effect_settings` as given (undefined leaves the field out). */
async function connectWithEffectSettings(page: Page, effectSettings: Record<string, string[]> | undefined) {
  const mock = await mockBoard(page);
  if (effectSettings === undefined) delete mock.board.info["effect_settings"];
  else mock.board.info["effect_settings"] = effectSettings;
  await page.goto("/");
  await page.getByLabel("Address of your Zenit").fill(MOCK_URL);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Connection: (WiFi|USB)/ })).toBeVisible();
  return mock;
}

test("shows the settings the board names for an effect, in its order", async ({ page }) => {
  await connectWithEffectSettings(page, { static: ["floor", "color"] });
  const settings = page.getByTestId("effect-settings");
  await expect(settings.getByRole("slider", { name: "Dimmest level" })).toHaveCount(1);
  await expect(settings.getByRole("group", { name: "Color", exact: true })).toHaveCount(1);
  const text = await settings.innerText();
  expect(text.indexOf("Dimmest level")).toBeLessThan(text.indexOf("Color"));
  await expect(page.getByTestId("newer-effect")).toHaveCount(0);
});

test("says the effect is newer when the board names a setting the app does not know", async ({ page }) => {
  await connectWithEffectSettings(page, { static: ["color", "sparkle"] });
  const settings = page.getByTestId("effect-settings");
  await expect(settings.getByRole("group", { name: "Color", exact: true })).toHaveCount(1);
  await expect(settings.getByTestId("newer-effect")).toHaveText(
    "This Zenit has a newer effect. Update the app to adjust its settings.",
  );
});

test("uses its own list of settings with a board that reports none", async ({ page }) => {
  await connectWithEffectSettings(page, undefined);
  await page.getByRole("radio", { name: "Breathing", exact: true }).check({ force: true });
  const settings = page.getByTestId("effect-settings");
  await expect(settings.getByRole("slider", { name: "Length of a breath" })).toHaveCount(1);
  await expect(settings.getByRole("slider", { name: "Dimmest level" })).toHaveCount(1);
  await expect(settings.getByTestId("newer-effect")).toHaveCount(0);
});

test("offers only the colors the board lists", async ({ page }) => {
  const mock = await mockBoard(page);
  const answer = mock.board.answer;
  mock.board.answer = (request) =>
    answer(request).map((reply) => (request["cmd"] === "info" ? { ...reply, colors: ["white", "blue"] } : reply));
  mock.board.settings["colors"] = ["white", "blue"];
  await page.goto("/");
  await page.getByLabel("Address of your Zenit").fill(MOCK_URL);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Warm white" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Blue" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Red" })).toHaveCount(0);
});

test("shows the power limit note when the light is reduced", async ({ page }) => {
  const mock = await mockBoard(page);
  const light = mock.board.light.bind(mock.board);
  mock.board.light = () => ({ ...light(), power_scale: 80 });
  await page.goto("/");
  await page.getByLabel("Address of your Zenit").fill(MOCK_URL);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Light reduced to 80% to stay cool.")).toBeVisible();
});

test("says the timer ended, and the light stays off", async ({ page }) => {
  const mock = await mockBoard(page);
  mock.board.settings["timer_minutes"] = 30;
  mock.board.on = false;
  const light = mock.board.light.bind(mock.board);
  mock.board.light = () => ({ ...light(), timer: { minutes: 30, remaining: 0 } });
  await page.goto("/");
  await page.getByLabel("Address of your Zenit").fill(MOCK_URL);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByTestId("timer-line")).toHaveText("The timer ended. The light stays off until you turn it on.");
  await expect(page.getByTestId("power-button")).toHaveAttribute("aria-pressed", "false");
});
