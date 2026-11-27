// SPDX-License-Identifier: GPL-3.0-or-later

import { expect, test } from "./fixtures.ts";
import { installFakeSerial, serialUse } from "./fake-serial.ts";
import { MOCK_USB_URL, mockBoard } from "./mock-board.ts";

// Web Serial is played by a fake port wired to a scripted board: no real port is touched.

async function connectUsb(page: import("@playwright/test").Page) {
  const mock = await mockBoard(page);
  await installFakeSerial(page, MOCK_USB_URL);
  await page.goto("/");
  await page.getByRole("button", { name: "Connect with USB" }).click();
  await expect(page.getByTestId("connection")).toContainText("USB");
  return mock;
}

test("connects over USB the way the protocol asks, and shows the USB note", async ({ page }) => {
  const mock = await connectUsb(page);
  const use = await serialUse(page);
  expect(use.requested).toBe(1);
  expect(use.filters).toEqual([{ usbVendorId: 0x303a }]);
  expect(use.openOptions).toEqual({ baudRate: 115200, bufferSize: 8192 });
  expect(mock.commands().slice(0, 3)).toEqual(["info", "settings_get", "status"]);
  await expect(page.getByText("Connected by USB. The light gets no power from USB")).toBeVisible();
});

test("never touches the control lines of the port", async ({ page }) => {
  await connectUsb(page);
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.getByRole("button", { name: /^Connection:/ }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  expect((await serialUse(page)).setSignals).toBe(0);
});

test("controls the light over USB, and ignores the board's log lines", async ({ page }) => {
  const mock = await connectUsb(page);
  await page.getByRole("radio", { name: "Breathing" }).check({ force: true });
  await expect(page.getByTestId("live-effect")).toHaveText("Breathing");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.getByTestId("power-button")).toHaveAttribute("aria-pressed", "false");
  expect(mock.commands()).toContain("settings_set");
  expect(mock.commands()).toContain("light");
});

test("closes the port when disconnecting", async ({ page }) => {
  await connectUsb(page);
  await page.getByRole("button", { name: /^Connection:/ }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toBeVisible();
  expect((await serialUse(page)).closed).toBe(1);
});

test("resets to the defaults over USB, after a confirmation", async ({ page }) => {
  const mock = await connectUsb(page);
  await page.getByRole("radio", { name: "Twinkle" }).check({ force: true });
  await expect(page.getByTestId("live-effect")).toHaveText("Twinkle");
  await page.getByRole("link", { name: "Device" }).click();
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Every setting goes back to its default.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(mock.commands()).not.toContain("settings_reset");
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Reset", exact: true }).click();
  await expect.poll(() => mock.commands()).toContain("settings_reset");
  await page.getByRole("link", { name: "Light" }).click();
  await expect(page.getByRole("radio", { name: "Steady" })).toBeChecked();
});

test("lets go of the port before the installer takes it", async ({ page }) => {
  await connectUsb(page);
  await page.getByRole("link", { name: "Device" }).click();
  await page.getByRole("button", { name: "Install or update firmware" }).click();
  await page.getByRole("alertdialog").getByLabel("The panel power socket is unplugged").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("esp-web-install-button")).toBeAttached();
  expect((await serialUse(page)).closed).toBe(1);
  await expect(page.getByRole("button", { name: "Connection: Not connected" })).toBeVisible();
});

test("says so when the port cannot be opened", async ({ page }) => {
  await installFakeSerial(page, "ws://127.0.0.1:9/never");
  await page.goto("/");
  await page.getByRole("button", { name: "Connect with USB" }).click();
  await expect(page.getByRole("alert")).toContainText("The USB port could not be opened.");
});

test("does nothing, quietly, when the port chooser is closed", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: { requestPort: () => Promise.reject(new DOMException("No port selected by the user.", "NotFoundError")) },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Connect with USB" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect with USB" })).toBeEnabled();
});
