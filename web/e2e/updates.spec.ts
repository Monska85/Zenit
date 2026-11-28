// SPDX-License-Identifier: GPL-3.0-or-later

// The Firmware card and the update and time settings under Advanced, against the mock board.

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
  await expect(page.getByTestId("update-result").or(page.getByTestId("update-off"))).toBeVisible();
  return mock;
}

/** Opens the folded Advanced settings. */
async function openAdvanced(page: Page): Promise<void> {
  await page.getByText("Advanced settings", { exact: true }).click();
  await expect(page.getByRole("region", { name: "Update settings" })).toBeVisible();
}

const result = (page: Page) => page.getByTestId("update-result");

/** The site publishes this firmware version. */
async function publishFirmware(page: Page, version: string): Promise<void> {
  await page.route("**/firmware/manifest.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        name: "Zenit",
        version,
        builds: [{ chipFamily: "ESP32-C3", parts: [{ path: "zenit-esp32c3-factory.bin", offset: 0 }] }],
      }),
    }),
  );
}

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
  // One message, and no Reconnect to press: the page connects again by itself
  await expect(page.getByTestId("auto-reconnect")).toHaveText(
    "Zenit is restarting. It connects again by itself in a few seconds.",
  );
  await expect(page.getByTestId("auto-reconnect")).toHaveRole("status");
  await expect(page.getByRole("button", { name: "Connection: Restarting..." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  // The board is back: the app finds it by itself
  mock.refuse = false;
  mock.board.update = { ...mock.board.update, state: "idle", target: null, last_result: "installed", available: null };
  mock.board.info["firmware"] = "9.9.9";
  await expect(page.getByTestId("connection")).toContainText("WiFi", { timeout: 15_000 });
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

test("says an available update once, in the one Firmware card, with its actions", async ({ page }) => {
  await publishFirmware(page, "1.2.0");
  await deviceView(page, { last_result: "available", available: "1.2.0" });
  const card = page.getByRole("region", { name: "Firmware", exact: true });
  await expect(card.getByTestId("firmware-running")).toHaveText("1.0.0");
  await expect(card.getByTestId("firmware-published")).toHaveText("1.2.0");
  await expect(card.getByTestId("update-result")).toHaveText("Version 1.2.0 is available.");
  await expect(card.getByTestId("firmware-state")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Check now" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Install 1.2.0" })).toBeVisible();
  await expect(page.getByText(/is available\./)).toHaveCount(1);
});

test("compares with the published firmware while the board's own check says nothing", async ({ page }) => {
  await publishFirmware(page, "1.2.0");
  await deviceView(page, { last_result: "never", available: null });
  await expect(page.getByTestId("update-result")).toHaveText("Zenit has not looked for an update yet.");
  await expect(page.getByTestId("firmware-state")).toHaveText("An update is available.");
});

test("says once that this site has a newer version than the board's last check found", async ({ page }) => {
  await publishFirmware(page, "1.2.0");
  await deviceView(page, { last_result: "up_to_date", available: null });
  const card = page.getByRole("region", { name: "Firmware", exact: true });
  await expect(card.getByTestId("update-result")).toHaveText(
    "This site has a newer version than the one Zenit found when it last looked.",
  );
  await expect(card.getByTestId("firmware-state")).toHaveCount(0);
  await expect(card.getByText("Your Zenit has the latest firmware.")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Your Zenit" }).locator("dd").nth(2)).toHaveText(
    "1.0.0 · Update available",
  );
});

test("keeps saying a newer version is published while firmware updates are off", async ({ page }) => {
  await publishFirmware(page, "1.2.0");
  await deviceView(page, { last_result: "up_to_date", available: null }, (board) => {
    board.settings["update_firmware"] = false;
  });
  const card = page.getByRole("region", { name: "Firmware", exact: true });
  await expect(card.getByTestId("update-off")).toBeVisible();
  await expect(card.getByTestId("firmware-state")).toHaveText("An update is available.");
});

test("names the board, its connection and its firmware first, and folds the rest for technicians", async ({ page }) => {
  await deviceView(page, { last_result: "up_to_date", available: null });
  const card = page.getByRole("region", { name: "Your Zenit" });
  await expect(card.locator("dl").first().locator("dt")).toHaveText(["Name", "Connection", "Firmware"]);
  await expect(card.locator("dl").first().locator("dd")).toHaveText(["zenit-a1b2", MOCK_URL, "1.0.0 · Up to date"]);
  const details = card.getByTestId("technician-details");
  await expect(details).toBeHidden();
  await card.getByText("Details for technicians").click();
  await expect(details.locator("dt")).toHaveText([
    "Hardware",
    "Light power limit",
    "Colors",
    "Effects",
    "Palettes",
    "Protocol",
    "Free memory",
    "Settings memory",
  ]);
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
    await openAdvanced(page);
    await page.getByRole("switch", { name: /Update the app on Zenit/ }).click();
    await expect.poll(() => mock.board.settings["update_web"]).toBe(false);
    await expect(card(page).getByTestId("web-off")).toBeVisible();
  });
});

test.describe("the settings", () => {
  const sets = (mock: Mock) => mock.board.requests.filter((request) => request["cmd"] === "settings_set");

  test("folds the update and time settings under Advanced", async ({ page }) => {
    await deviceView(page);
    const advanced = page.getByTestId("advanced");
    await expect(advanced.getByRole("region", { name: "Update settings" })).toBeHidden();
    await expect(advanced.getByRole("region", { name: "Time", exact: true })).toBeHidden();
    await openAdvanced(page);
    await expect(advanced.getByRole("region", { name: "Time", exact: true })).toBeVisible();
    // The order of the page: the everyday cards first, Advanced, Access, Maintenance last
    await expect(page.locator("main h2").or(page.getByText("Advanced settings", { exact: true }))).toHaveText([
      "Your Zenit",
      "WiFi",
      "Firmware",
      "App on Zenit",
      "Advanced settings",
      "Update settings",
      "Time",
      "Access over WiFi",
      "Maintenance",
    ]);
  });

  test("sends the update mode and the firmware switch when they are chosen", async ({ page }) => {
    const mock = await deviceView(page);
    await openAdvanced(page);
    await page.getByRole("radio", { name: "Tell me" }).check({ force: true });
    await expect.poll(() => mock.board.settings["update_mode"]).toBe("notify");
    const firmware = page.getByRole("switch", { name: /Update the firmware/ });
    await expect(firmware).toBeChecked();
    await firmware.click();
    await expect.poll(() => mock.board.settings["update_firmware"]).toBe(false);
    await expect(firmware).not.toBeChecked();
  });

  test("sends the check interval as soon as it is chosen from the list", async ({ page }) => {
    const mock = await deviceView(page);
    await openAdvanced(page);
    const list = page.getByRole("region", { name: "Update settings" }).getByLabel("Look for updates");
    await expect(list.locator("option")).toHaveText([
      "Every hour",
      "Every 3 hours",
      "Every 6 hours",
      "Every 12 hours",
      "Every 24 hours",
    ]);
    await list.selectOption({ label: "Every 12 hours" });
    await expect.poll(() => mock.board.settings["check_hours"]).toBe(12);
    expect(sets(mock)).toHaveLength(1);
  });

  test("keeps a stored interval that is not in the list, shown and chosen", async ({ page }) => {
    const mock = await deviceView(page, {}, (board) => {
      board.settings["check_hours"] = 48;
    });
    await openAdvanced(page);
    const list = page.getByLabel("Look for updates");
    await expect(list).toHaveValue("48");
    await expect(list.locator("option:checked")).toHaveText("Every 48 hours");
    await list.selectOption({ label: "Every 3 hours" });
    await expect.poll(() => mock.board.settings["check_hours"]).toBe(3);
    // The stored value stays selectable until the page knows the new one
    await list.selectOption({ label: "Every 24 hours" });
    await expect.poll(() => mock.board.settings["check_hours"]).toBe(24);
  });

  test("sends the install window once both times are valid, and explains it", async ({ page }) => {
    const mock = await deviceView(page);
    await openAdvanced(page);
    await expect(page.getByTestId("window-summary")).toContainText("Any time of day.");
    await expect(page.getByRole("button", { name: "Set window" })).toHaveCount(0);
    await page.getByLabel("From").fill("23:00");
    await page.getByLabel("Until").fill("02:30");
    await page.getByLabel("Until").blur();
    await expect.poll(() => mock.board.settings["install_end"]).toBe(150);
    expect(mock.board.settings["install_start"]).toBe(1380);
    await expect(page.getByTestId("window-summary")).toContainText("From 23:00 to 02:30 (past midnight).");
    await expect(page.getByTestId("window-summary")).toContainText("If both times are the same");
  });

  test("sends the install window a moment after the last change, without leaving the field", async ({ page }) => {
    const mock = await deviceView(page);
    await openAdvanced(page);
    await page.getByLabel("Until").fill("05:00");
    await expect.poll(() => mock.board.settings["install_end"]).toBe(300);
  });

  test("sends nothing while a time of the window is not complete", async ({ page }) => {
    const mock = await deviceView(page);
    await openAdvanced(page);
    await page.getByLabel("From").fill("");
    await page.getByLabel("From").blur();
    await expect(page.getByRole("region", { name: "Update settings" }).getByRole("alert")).toHaveText(
      "Choose a time of day for both, like 03:00.",
    );
    await page.waitForTimeout(1500);
    expect(sets(mock)).toHaveLength(0);
  });

  test("keeps the install window for the automatic mode", async ({ page }) => {
    await deviceView(page, {}, (board) => {
      board.settings["update_mode"] = "notify";
    });
    await openAdvanced(page);
    await expect(page.getByLabel("From")).toBeDisabled();
    await expect(page.getByLabel("Until")).toBeDisabled();
  });

  test("finds a time zone by city or country and sends it when chosen, with the keyboard or a tap", async ({
    page,
  }) => {
    const mock = await deviceView(page);
    await openAdvanced(page);
    const card = page.getByRole("region", { name: "Time", exact: true });
    await expect(card.getByTestId("time-zone-current")).toHaveText("UTC");
    const search = card.getByRole("combobox", { name: "Find a time zone" });
    const list = card.getByRole("listbox", { name: "Time zones" });
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await search.fill("india");
    await expect(search).toHaveAttribute("aria-expanded", "true");
    await expect(list.getByRole("option").first()).toHaveText(/^Kolkata \(India\)/);
    // Down points at the first option, Enter chooses it: sent at once, the field emptied and the list closed
    await search.press("ArrowDown");
    const first = list.getByRole("option").first();
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(search).toHaveAttribute("aria-activedescendant", (await first.getAttribute("id"))!);
    await search.press("Enter");
    await expect.poll(() => mock.board.settings["timezone"]).toBe("IST-5:30");
    await expect(search).toHaveValue("");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(card.getByTestId("time-zone-current")).toHaveText("Kolkata (India)");
    // At most 8 suggestions; a tap chooses one, and the board's string is named by the zone chosen here
    await search.fill("united");
    await expect(list.getByRole("option")).toHaveCount(8);
    await search.fill("amsterdam");
    await list.getByRole("option", { name: /Amsterdam/ }).click();
    await expect.poll(() => mock.board.settings["timezone"]).toBe("CET-1CEST,M3.5.0,M10.5.0/3");
    await expect(card.getByTestId("time-zone-current")).toHaveText("Amsterdam (Netherlands)");
    // Escape closes the list, a second Escape clears the text; nothing found says so
    await search.fill("rome");
    await search.press("Escape");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(search).toHaveValue("rome");
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await search.fill("atlantis");
    await expect(card.getByText("No time zone matches.", { exact: false })).toBeVisible();
    // Only the two choices reached the board: typing and moving through the list send nothing
    expect(sets(mock)).toHaveLength(2);
  });

  test("takes a POSIX time zone typed by hand, after checking it, and shows it as it is", async ({ page }) => {
    const mock = await deviceView(page);
    await openAdvanced(page);
    const card = page.getByRole("region", { name: "Time", exact: true });
    const raw = card.getByTestId("time-zone-raw");
    await expect(raw).not.toHaveAttribute("open");
    await raw.getByText("Type a POSIX time zone").click();
    const text = card.getByLabel("Time zone text");
    await text.fill("bad zone");
    await card.getByRole("button", { name: "Set", exact: true }).first().click();
    await expect(card.getByRole("alert")).toContainText("no spaces");
    await text.fill("XYZ-5:15");
    await card.getByRole("button", { name: "Set", exact: true }).first().click();
    await expect.poll(() => mock.board.settings["timezone"]).toBe("XYZ-5:15");
    // A string no zone has is shown as it is
    await expect(card.getByTestId("time-zone-current")).toHaveText("XYZ-5:15");
  });

  test("opens the typed time zone by itself for a string no zone has", async ({ page }) => {
    await deviceView(page, {}, (board) => {
      board.settings["timezone"] = "XYZ-5:15";
    });
    await openAdvanced(page);
    const card = page.getByRole("region", { name: "Time", exact: true });
    await expect(card.getByTestId("time-zone-current")).toHaveText("XYZ-5:15");
    await expect(card.getByTestId("time-zone-raw")).toHaveAttribute("open");
    await expect(card.getByLabel("Time zone text")).toHaveValue("XYZ-5:15");
    // A zone chosen by search closes it again
    const search = card.getByRole("combobox", { name: "Find a time zone" });
    await search.fill("kolkata");
    await search.press("ArrowDown");
    await search.press("Enter");
    await expect(card.getByTestId("time-zone-current")).toHaveText("Kolkata (India)");
    await expect(card.getByTestId("time-zone-raw")).not.toHaveAttribute("open");
  });

  test("keeps a person's open or close of the typed time zone for that string only", async ({ page }) => {
    const mock = await deviceView(page);
    await openAdvanced(page);
    const card = page.getByRole("region", { name: "Time", exact: true });
    const raw = card.getByTestId("time-zone-raw");
    const summary = raw.getByText("Type a POSIX time zone");
    // Opened by the person on a named zone, it stays open
    await summary.click();
    await expect(raw).toHaveAttribute("open");
    await card.getByLabel("Time zone text").fill("XYZ-5:15");
    await card.getByRole("button", { name: "Set", exact: true }).first().click();
    await expect.poll(() => mock.board.settings["timezone"]).toBe("XYZ-5:15");
    await expect(raw).toHaveAttribute("open");
    // Closed by the person while the string has no zone, it stays closed
    await summary.click();
    await expect(raw).not.toHaveAttribute("open");
    await page.waitForTimeout(1500);
    await expect(raw).not.toHaveAttribute("open");
    // A named zone chosen by search: closed by the rule
    const search = card.getByRole("combobox", { name: "Find a time zone" });
    await search.fill("rome");
    await card.getByRole("option", { name: /Rome/ }).click();
    await expect.poll(() => mock.board.settings["timezone"]).toBe("CET-1CEST,M3.5.0,M10.5.0/3");
    await expect(raw).not.toHaveAttribute("open");
  });

  test("sends the time server after a check of what was typed, and the time check interval when chosen", async ({
    page,
  }) => {
    const mock = await deviceView(page);
    await openAdvanced(page);
    const server = page.getByLabel("Time server");
    await server.fill("bad host");
    await server.press("Enter");
    await expect(page.getByRole("region", { name: "Time", exact: true }).getByRole("alert")).toContainText(
      "pool.ntp.org",
    );
    await server.fill("time.example.org");
    await server.press("Enter");
    await expect.poll(() => mock.board.settings["ntp_server"]).toBe("time.example.org");
    await page.getByLabel("Check the time").selectOption({ label: "Every 3 hours" });
    await expect.poll(() => mock.board.settings["time_sync_hours"]).toBe(3);
  });
});

test.describe("the time zone of this device", () => {
  test.use({ timezoneId: "Europe/Rome" });

  test("is offered first on the Device page, outside Advanced, and saved when pressed", async ({ page }) => {
    const mock = await deviceView(page);
    const offer = page.getByTestId("time-zone-offer");
    await expect(page.locator("main h2").first()).toHaveText("Time zone");
    await expect(offer).toContainText("Zenit uses UTC time.");
    await offer.getByRole("button", { name: "Use this device's time zone (Rome)" }).click();
    await expect.poll(() => mock.board.settings["timezone"]).toBe("CET-1CEST,M3.5.0,M10.5.0/3");
    await expect(offer).toHaveCount(0);
    await openAdvanced(page);
    await expect(page.getByTestId("time-zone-current")).toHaveText("Rome (Italy)");
  });

  test("is not offered when the board has the same rules, and names the board's zone by this device's", async ({
    page,
  }) => {
    await deviceView(page, {}, (board) => {
      board.settings["timezone"] = "CET-1CEST,M3.5.0,M10.5.0/3";
    });
    await expect(page.getByTestId("time-zone-offer")).toHaveCount(0);
    await openAdvanced(page);
    await expect(page.getByTestId("time-zone-current")).toHaveText("Rome (Italy)");
  });

  test("names the board's other zone in the offer", async ({ page }) => {
    await deviceView(page, {}, (board) => {
      board.settings["timezone"] = "IST-5:30";
    });
    await expect(page.getByTestId("time-zone-offer")).toContainText("Zenit uses Kolkata (India) time.");
  });
});
