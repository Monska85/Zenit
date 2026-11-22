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
  await expect(page.getByTestId("connection")).toBeVisible();
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
  await page.waitForTimeout(300);
  expect(mock.commands().filter((command) => command === "settings_set")).toHaveLength(0);
  await expect(thumb).not.toHaveAttribute("aria-valuenow", "60");
  await page.mouse.up();
  await expect.poll(() => mock.commands().filter((command) => command === "settings_set")).toHaveLength(1);
  const sent = mock.board.requests.filter((request) => request["cmd"] === "settings_set")[0]!;
  expect(Object.keys(sent).sort()).toEqual(["brightness", "cmd", "seq"]);
});

test("sends each choice as one setting, and only that", async ({ page }) => {
  const mock = await connect(page);
  await page.getByRole("radio", { name: "Breathing" }).check({ force: true });
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
  await page.getByRole("radio", { name: "Breathing" }).check({ force: true });
  await expect(page.getByRole("alert")).toHaveText("Zenit did not accept that value.");
  await expect(page.getByRole("radio", { name: "Steady" })).toBeChecked();
  await page.getByRole("button", { name: "Close this message" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
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
  await expect(page.getByText("Connection lost", { exact: true })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole("alert")).toContainText("Zenit did not answer");
  await expect(page.getByRole("button", { name: "Reconnect" })).toBeEnabled();
  await expect(page.getByRole("slider", { name: "Brightness" })).toHaveAttribute("aria-valuenow", "60");
});

test("shows the last values, disabled, after the link drops, and reconnects to the same address", async ({ page }) => {
  const mock = await connect(page);
  await page.getByRole("radio", { name: "Twinkle" }).check({ force: true });
  await expect(page.getByTestId("live-effect")).toHaveText("Twinkle");
  mock.drop();
  await expect(page.getByText("Connection lost", { exact: true })).toBeVisible({ timeout: 10_000 });
  // The Light view stays, greyed, with the last values: no Connect screen
  await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Light", exact: true })).toBeDisabled();
  await expect(page.getByRole("slider", { name: "Brightness" })).toHaveAttribute("data-disabled", "");
  await expect(page.getByRole("radio", { name: "Steady" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "Twinkle" })).toBeChecked();
  await expect(page.getByText("Connection lost. These are the last values Zenit reported.")).toBeVisible();
  // Reconnect opens the same address again, with nothing typed
  const before = mock.commands().filter((command) => command === "info").length;
  await page.getByRole("button", { name: "Reconnect" }).click();
  await expect(page.getByTestId("connection")).toHaveText("Connected over WiFi");
  expect(mock.commands().filter((command) => command === "info").length).toBe(before + 1);
  await expect(page.getByRole("button", { name: "Light", exact: true })).toBeEnabled();
  await expect(page.getByRole("radio", { name: "Twinkle" })).toBeChecked();
  await expect(page.getByRole("alert")).toHaveCount(0);
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
  await page.waitForTimeout(1200);
  const sent = mock.board.requests.filter((request) => request["cmd"] === "settings_set");
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ brightness: 57 });
});

test("keeps showing the last choice while an earlier one is answered late", async ({ page }) => {
  const mock = await connect(page);
  // The board takes 600 ms for the first save and 2.5 s for the second
  let saves = 0;
  mock.delay = (request) => (request["cmd"] === "settings_set" ? (saves++ === 0 ? 600 : 2500) : 0);
  await page.getByRole("radio", { name: "Breathing" }).check({ force: true });
  await page.getByRole("radio", { name: "Twinkle" }).check({ force: true });
  // After the first answer, the second is still on its way: the choice on screen is the second
  await expect.poll(() => mock.board.settings["effect"], { timeout: 5000 }).toBe("twinkle");
  await page.waitForTimeout(900);
  await expect(page.getByRole("radio", { name: "Twinkle" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Breathing" })).not.toBeChecked();
  await expect(page.getByTestId("live-effect")).toHaveText("Twinkle", { timeout: 5000 });
});

test("offers an effect it does not know, as a plain card with no settings", async ({ page }) => {
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
  await expect(page.getByText("Light reduced to 80 % to stay cool.")).toBeVisible();
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
  await expect(page.getByTestId("power-state")).toHaveText("Off");
});
