// SPDX-License-Identifier: GPL-3.0-or-later

// The firmware update card and the update and time settings, against the mock board.

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { MOCK_URL, mockBoard, type Mock } from "./mock-board.ts";
import { FakeBoard } from "../test/helpers.ts";

type Update = Record<string, unknown>;

async function deviceView(page: Page, update: Update = {}, patch: (board: FakeBoard) => void = () => undefined) {
  const board = new FakeBoard().withNetwork();
  board.info["firmware"] = "1.0.0";
  board.update = { ...board.update, ...update };
  patch(board);
  const mock = await mockBoard(page, board);
  await page.goto("/");
  await page.getByLabel("Address of your Zenit").fill(MOCK_URL);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("link", { name: "Device" }).click();
  await expect(page.getByRole("heading", { name: "Firmware updates" })).toBeVisible();
  return mock;
}

const result = (page: Page) => page.getByTestId("update-result");

test("shows the running version, the last check in local time and the result", async ({ page }) => {
  await deviceView(page, { last_check: 1_800_000_000, last_result: "up_to_date" });
  await expect(page.getByTestId("firmware-running")).toHaveText("1.0.0");
  await expect(result(page)).toHaveText("Your Zenit has the latest firmware.");
  await expect(page.getByTestId("update-checked")).toHaveText(/^Last checked .*2027/);
});

for (const [code, words] of [
  ["never", "has not looked for an update yet"],
  ["unreachable", "could not reach the update site"],
  ["not_published", "The project site has no firmware published yet"],
  ["tls_error", "did not trust the update site's security certificate"],
  ["bad_manifest", "update information on the site is not valid"],
  ["bad_download", "The download was damaged"],
  ["flash_error", "could not write the new firmware"],
  ["no_time", "does not know the time yet"],
] as const) {
  test(`says in plain words what ${code} means`, async ({ page }) => {
    await deviceView(page, { last_result: code });
    await expect(result(page)).toContainText(words);
  });
}

test("looks for an update now and follows the result by polling", async ({ page }) => {
  const mock = await deviceView(page, { last_result: "up_to_date" });
  await page.getByRole("button", { name: "Check now" }).click();
  await expect(page.getByTestId("update-progress")).toContainText("Looking for an update...");
  await expect(page.getByRole("button", { name: "Check now" })).toBeDisabled();
  mock.board.update = {
    ...mock.board.update,
    state: "idle",
    target: null,
    last_result: "available",
    available: "9.9.9",
  };
  await expect(result(page)).toHaveText("Version 9.9.9 is available.", { timeout: 5000 });
  await expect(page.getByRole("button", { name: "Install 9.9.9" })).toBeVisible();
  expect(mock.commands()).toContain("update_check");
});

test("asks before it installs, says the board restarts, and shows the progress", async ({ page }) => {
  const mock = await deviceView(page, { last_result: "available", available: "9.9.9" });
  await page.getByRole("button", { name: "Install 9.9.9" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Zenit downloads the new firmware and then restarts.");
  await expect(dialog).toContainText("fades in again");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(mock.commands()).not.toContain("update_install");
  await page.getByRole("button", { name: "Install 9.9.9" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Install", exact: true }).click();
  await expect.poll(() => mock.commands()).toContain("update_install");
  const install = mock.board.requests.find((request) => request["cmd"] === "update_install");
  expect(install).toMatchObject({ target: "firmware" });
  expect(install).not.toHaveProperty("force");
  mock.board.update = { ...mock.board.update, state: "downloading", progress: 40 };
  const bar = page.getByRole("progressbar", { name: "Download progress" });
  await expect(bar).toHaveAttribute("aria-valuenow", "40", { timeout: 5000 });
  await expect(page.getByTestId("update-progress")).toContainText("Downloading the update: 40 %");
  mock.board.update = { ...mock.board.update, state: "verifying", progress: null };
  await expect(page.getByTestId("update-progress")).toContainText("Checking the download...", { timeout: 5000 });
});

test("shows that the board restarts and connects again by itself", async ({ page }) => {
  const mock = await deviceView(page, { state: "restarting" });
  await expect(page.getByTestId("update-progress")).toContainText("Restarting");
  mock.refuse = true;
  mock.drop();
  await expect(page.getByTestId("auto-reconnect")).toHaveText("The board is restarting");
  await expect(
    page.getByText("The board is restarting. This page connects again by itself in a few seconds."),
  ).toBeVisible();
  // The board is back: the app finds it by itself
  mock.refuse = false;
  mock.board.update = { ...mock.board.update, state: "idle", target: null, last_result: "installed", available: null };
  mock.board.info["firmware"] = "9.9.9";
  await expect(page.getByTestId("connection")).toHaveText("Connected over WiFi", { timeout: 15_000 });
  await expect(page.getByTestId("firmware-running")).toHaveText("9.9.9");
  expect(mock.connections()).toBeGreaterThanOrEqual(2);
});

test("offers Install anyway for a skipped version, with a warning, and sends force", async ({ page }) => {
  const mock = await deviceView(page, { last_result: "skipped", available: "9.9.9", skipped: "9.9.9" });
  await expect(result(page)).toContainText("did not work on this Zenit before");
  await expect(page.getByRole("button", { name: "Install 9.9.9", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Install 9.9.9 anyway" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("It may fail the same way.");
  await dialog.getByRole("button", { name: "Install anyway" }).click();
  await expect
    .poll(() => mock.board.requests.find((request) => request["cmd"] === "update_install"))
    .toMatchObject({
      target: "firmware",
      force: true,
    });
});

test("says a firmware is on trial and that a version was rolled back", async ({ page }) => {
  await deviceView(page, { trial: true, rolled_back: "1.1.0", skipped: "1.1.0", last_result: "up_to_date" });
  await expect(page.getByText("This firmware is on trial.")).toBeVisible();
  await expect(page.getByText("Version 1.1.0 did not work on this Zenit, so Zenit went back")).toBeVisible();
  await expect(page.getByText("Version 1.1.0 is set aside and is not installed by itself.")).toBeVisible();
});

test("says updates are off and disables the check", async ({ page }) => {
  await deviceView(page, { mode: "off" }, (board) => {
    board.settings["update_mode"] = "off";
  });
  await expect(page.getByTestId("update-off")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check now" })).toBeDisabled();
});

test("needs WiFi to look for updates", async ({ page }) => {
  await deviceView(page, {}, (board) => {
    board.wifi = { ...board.wifi, state: "connecting", rssi: null, ip: null };
  });
  await expect(page.getByText("Zenit needs WiFi to look for and install updates.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check now" })).toBeDisabled();
});

test.describe("the app on Zenit", () => {
  const card = (page: Page) => page.getByRole("region", { name: "App on Zenit" });

  test("shows the version of the app on board and the last check", async ({ page }) => {
    await deviceView(page, {
      web: { state: "ok", version: "1.0.0", available: null, last_result: "up_to_date", retry_in: null },
    });
    await expect(card(page).getByTestId("web-state")).toContainText("Zenit has this app on board");
    await expect(card(page).getByTestId("web-version")).toHaveText("Version 1.0.0.");
    await expect(card(page).getByTestId("web-result")).toHaveText("Zenit has the latest version of the app.");
  });

  test("says when a missing app is tried again", async ({ page }) => {
    await deviceView(page, {
      web: { state: "missing", version: null, available: null, last_result: "unreachable", retry_in: 300 },
    });
    await expect(card(page).getByTestId("web-state")).toContainText("no copy of this app on board");
    await expect(card(page).getByTestId("web-retry")).toHaveText("Zenit tries again in about 5 minutes.");
  });

  test("asks before it installs a new app, then sends target web", async ({ page }) => {
    const mock = await deviceView(page, {
      web: { state: "ok", version: "1.0.0", available: "1.1.0", last_result: "available", retry_in: null },
    });
    await card(page).getByRole("button", { name: "Install app 1.1.0" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("It does not restart.");
    await dialog.getByRole("button", { name: "Install", exact: true }).click();
    await expect
      .poll(() => mock.board.requests.find((request) => request["cmd"] === "update_install"))
      .toMatchObject({ target: "web" });
  });

  test("sends the app switch when it is chosen", async ({ page }) => {
    const mock = await deviceView(page);
    await page.getByRole("switch", { name: /Update the app on Zenit/ }).click();
    await expect.poll(() => mock.board.settings["update_web"]).toBe(false);
    await expect(card(page).getByTestId("web-off")).toBeVisible();
  });
});

test.describe("the settings", () => {
  const sets = (mock: Mock) => mock.board.requests.filter((request) => request["cmd"] === "settings_set");

  test("sends the update mode and the firmware switch when they are chosen", async ({ page }) => {
    const mock = await deviceView(page);
    await page.getByRole("radio", { name: "Tell me" }).check({ force: true });
    await expect.poll(() => mock.board.settings["update_mode"]).toBe("notify");
    await page.getByRole("switch", { name: /Update the firmware/ }).click();
    await expect.poll(() => mock.board.settings["update_firmware"]).toBe(false);
  });

  test("sends the check interval only when Set is pressed, and refuses numbers out of range", async ({ page }) => {
    const mock = await deviceView(page);
    const card = page.getByRole("region", { name: "Update settings" });
    const field = card.getByLabel("Look for updates every (hours)");
    await field.fill("12");
    expect(sets(mock)).toHaveLength(0);
    await field.fill("169");
    await card.getByRole("button", { name: "Set", exact: true }).click();
    await expect(card.getByRole("alert")).toContainText("from 1 to 168");
    expect(sets(mock)).toHaveLength(0);
    await field.fill("12");
    await card.getByRole("button", { name: "Set", exact: true }).click();
    await expect.poll(() => mock.board.settings["check_hours"]).toBe(12);
  });

  test("sends the install window as minutes after midnight, and explains it", async ({ page }) => {
    const mock = await deviceView(page);
    await expect(page.getByTestId("window-summary")).toContainText("Any time of day.");
    await page.getByLabel("From").fill("23:00");
    await page.getByLabel("Until").fill("02:30");
    await page.getByRole("button", { name: "Set window" }).click();
    await expect.poll(() => mock.board.settings["install_start"]).toBe(1380);
    expect(mock.board.settings["install_end"]).toBe(150);
    await expect(page.getByTestId("window-summary")).toContainText("From 23:00 to 02:30 (past midnight).");
    await expect(page.getByTestId("window-summary")).toContainText("If both times are the same");
  });

  test("keeps the install window for the automatic mode", async ({ page }) => {
    await deviceView(page, {}, (board) => {
      board.settings["update_mode"] = "notify";
    });
    await expect(page.getByRole("button", { name: "Set window" })).toBeDisabled();
  });

  test("chooses a time zone from the list, or types one and checks it", async ({ page }) => {
    const mock = await deviceView(page);
    await page.getByLabel("Time zone", { exact: true }).selectOption({ label: "Rome, Paris, Berlin, Madrid" });
    await expect.poll(() => mock.board.settings["timezone"]).toBe("CET-1CEST,M3.5.0,M10.5.0/3");
    await page.getByLabel("Time zone", { exact: true }).selectOption({ label: "Another time zone..." });
    const card = page.getByRole("region", { name: "Time", exact: true });
    const text = card.getByLabel("Time zone text");
    await text.fill("bad zone");
    await card.getByRole("button", { name: "Set", exact: true }).first().click();
    await expect(card.getByRole("alert")).toContainText("no spaces");
    await text.fill("<+03>-3");
    await card.getByRole("button", { name: "Set", exact: true }).first().click();
    await expect.poll(() => mock.board.settings["timezone"]).toBe("<+03>-3");
    // A zone the list does not have shows as a custom one
    await expect(page.getByLabel("Time zone", { exact: true })).toHaveValue("custom");
  });

  test("sends the time server and the time check interval after a check of what was typed", async ({ page }) => {
    const mock = await deviceView(page);
    const server = page.getByLabel("Time server");
    await server.fill("bad host");
    await server.press("Enter");
    await expect(page.getByRole("region", { name: "Time", exact: true }).getByRole("alert")).toContainText(
      "pool.ntp.org",
    );
    await server.fill("time.example.org");
    await server.press("Enter");
    await expect.poll(() => mock.board.settings["ntp_server"]).toBe("time.example.org");
    const hours = page.getByLabel("Check the time every (hours)");
    await hours.fill("24");
    await hours.press("Enter");
    await expect.poll(() => mock.board.settings["time_sync_hours"]).toBe(24);
  });
});
