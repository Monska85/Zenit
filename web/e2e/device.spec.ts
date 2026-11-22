// SPDX-License-Identifier: GPL-3.0-or-later

import type { Page } from "@playwright/test";
import { connectByAddress, expect, test } from "./fixtures.ts";

/** The site publishes this firmware version; a test can publish another. */
async function publish(page: Page, version: string | null): Promise<void> {
  await page.route("**/firmware/manifest.json", (route) =>
    version === null
      ? route.fulfill({ status: 404, body: "Not found" })
      : route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            name: "Zenit",
            version,
            builds: [{ chipFamily: "ESP32-C3", parts: [{ path: "zenit-esp32c3-factory.bin", offset: 0 }] }],
          }),
        }),
  );
}

test("compares the firmware of the board with the published one", async ({ page, simulator }) => {
  await publish(page, "999.0.0");
  await connectByAddress(page, simulator.url);
  await page.getByRole("link", { name: "Device" }).click();
  await expect(page.getByTestId("firmware-published")).toHaveText("999.0.0");
  await expect(page.getByTestId("firmware-running")).not.toHaveText("");
  await expect(page.getByTestId("firmware-state")).toHaveText("An update is available.");
});

test("says a board is up to date or newer than the published firmware", async ({ page, simulator }) => {
  await connectByAddress(page, simulator.url);
  await page.getByRole("link", { name: "Device" }).click();
  const running = (await page.getByTestId("firmware-running").textContent())!;
  await publish(page, running.replace(/\+.*$/, ""));
  await page.reload();
  // the app reloads without its connection: connect again
  await connectByAddress(page, simulator.url);
  await page.getByRole("link", { name: "Device" }).click();
  await expect(page.getByTestId("firmware-state")).toHaveText(
    /^Your Zenit (is up to date|runs a newer build than the published one)\.$/,
  );
});

test("reads the manifest published next to the app", async ({ page }) => {
  await page.goto("/#/device");
  await expect(page.getByTestId("firmware-published")).toHaveText("1.0.0");
  await expect(page.getByText("Installs version 1.0.0 over a USB cable.")).toBeVisible();
  await expect(page.getByTestId("firmware-state")).toHaveCount(0);
});

test("says the published firmware cannot be read, and still offers the install", async ({ page }) => {
  await publish(page, null);
  await page.goto("/#/device");
  await expect(page.getByTestId("firmware-published")).toHaveText("Not available");
  await expect(page.getByText("The published firmware could not be read.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Install or update firmware" })).toBeEnabled();
});

test("refuses a manifest that is not a Zenit one", async ({ page }) => {
  await page.route("**/firmware/manifest.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ name: "Other", version: "1.0.0", builds: [] }),
    }),
  );
  await page.goto("/#/device");
  await expect(page.getByTestId("firmware-published")).toHaveText("Not available");
});

test("asks for the panel power socket to be unplugged before the installer", async ({ page }) => {
  await page.goto("/#/device");
  await page.getByRole("button", { name: "Install or update firmware" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Unplug the panel power socket from the wall before you connect the USB cable.");
  await expect(dialog).toContainText("Never connect USB and the panel power together.");
  await expect(dialog).toContainText("Your settings are kept.");
  await expect(dialog).toContainText("erase everything");
  const next = dialog.getByRole("button", { name: "Continue" });
  await expect(next).toBeDisabled();
  await dialog.getByLabel("The panel power socket is unplugged").check();
  await expect(next).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("esp-web-install-button")).toHaveCount(0);
});

test("loads the installer for the manifest of the site after the confirmation", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/device");
  await page.getByRole("button", { name: "Install or update firmware" }).click();
  await page.getByRole("alertdialog").getByLabel("The panel power socket is unplugged").check();
  await page.getByRole("button", { name: "Continue" }).click();
  const installer = page.locator("esp-web-install-button");
  await expect(installer).toHaveAttribute("manifest", "firmware/manifest.json");
  await expect(page.getByText("Keep the USB cable plugged in until the installer says it is done.")).toBeVisible();
  // The content security policy lets the installer work: nothing it needs is refused
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toBeVisible();
});

test("the installer is not loaded before it is needed", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });
  await page.goto("/#/device");
  await expect(page.getByRole("button", { name: "Install or update firmware" })).toBeVisible();
  expect(scripts.filter((url) => /install-dialog|installer/.test(url))).toEqual([]);
  await page.getByRole("button", { name: "Install or update firmware" }).click();
  await page.getByRole("alertdialog").getByLabel("The panel power socket is unplugged").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => scripts.some((url) => /installer/.test(url))).toBe(true);
});
