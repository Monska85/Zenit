// SPDX-License-Identifier: GPL-3.0-or-later

// The WiFi card over USB: Improv Wi-Fi Serial on the fake port, scripted with the frames of conformance/improv/frames.json.

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { installFakeSerial, scriptImprov } from "./fake-serial.ts";
import { packet, rpcCommandOf } from "./improv-frames.ts";
import { MOCK_URL, MOCK_USB_URL, mockBoard } from "./mock-board.ts";
import { FakeBoard } from "../test/helpers.ts";

type Reply = (frameHex: string) => string[] | Promise<string[]>;

/** A board that reports WiFi, then Improv answers from `reply`. Opens the Device view over USB. */
async function deviceOverUsb(page: Page, reply: Reply, board = new FakeBoard().withNetwork()) {
  const mock = await mockBoard(page, board);
  const improv = await scriptImprov(page, reply);
  await installFakeSerial(page, MOCK_USB_URL);
  await page.goto("/");
  await page.getByRole("button", { name: "Connect with USB" }).click();
  await expect(page.getByTestId("connection")).toContainText("USB");
  await page.getByRole("link", { name: "Device" }).click();
  await expect(page.getByTestId("wifi-setup")).toBeVisible();
  return { mock, improv };
}

const SCAN: Reply = (frame) => {
  switch (rpcCommandOf(frame)) {
    case 4:
      return [packet("one scanned network"), packet("the end of a scan")];
    case 2:
      return [packet("state ready")];
    default:
      return [];
  }
};

test("shows the WiFi state of the board and the setup over USB", async ({ page }) => {
  await deviceOverUsb(page, SCAN);
  await expect(page.getByTestId("wifi-state")).toHaveText('Connected to "HomeNet".');
  await expect(page.getByRole("heading", { name: "Set up the WiFi" })).toBeVisible();
  await expect(page.getByText("control it from its own address, http://zenit-a1b2.local/")).toBeVisible();
});

test("scans for networks and fills in the name of the one chosen", async ({ page }) => {
  const { improv } = await deviceOverUsb(page, SCAN);
  await page.getByRole("button", { name: "Scan for networks" }).click();
  const list = page.getByRole("list", { name: "Networks Zenit sees" });
  await expect(list.getByRole("button", { name: /HomeNet/ })).toContainText("fair signal, password");
  await list.getByRole("button", { name: /HomeNet/ }).click();
  await expect(page.getByLabel("Network name")).toHaveValue("HomeNet");
  expect(improv.frames().map(rpcCommandOf)).toEqual([4]);
});

test("says when no network is seen", async ({ page }) => {
  await deviceOverUsb(page, (frame) => (rpcCommandOf(frame) === 4 ? [packet("the end of a scan")] : []));
  await page.getByRole("button", { name: "Scan for networks" }).click();
  await expect(page.getByText("Zenit sees no networks. Type the name of yours below.")).toBeVisible();
});

test("connects, shows the progress and tells where to open the app", async ({ page }) => {
  const { mock, improv } = await deviceOverUsb(page, (frame) => {
    if (rpcCommandOf(frame) !== 1) return [];
    return [packet("state provisioning"), packet("state provisioned"), packet("empty result for wifi settings")];
  });
  await page.getByLabel("Network name").fill("HomeNet");
  await page.getByLabel("Password", { exact: true }).fill("correct-horse");
  await page.getByRole("button", { name: "Connect Zenit to this network" }).click();
  await expect(page.getByTestId("wifi-done")).toHaveText(
    "Connected as zenit-a1b2.local. Open http://zenit-a1b2.local/ on your phone or computer to control Zenit over WiFi. " +
      "If an Android phone cannot open it, allow Chrome to find devices on your network: Settings, Apps, Chrome, Permissions, Nearby devices.",
  );
  expect(improv.frames().map(rpcCommandOf)).toEqual([1]);
  // The password is not kept: not in the form, not in the browser's storage, not in the address
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage, location.href]))).not.toContain(
    "correct-horse",
  );
  expect(mock.commands()).toContain("status");
});

test("shows that it is connecting, up to 30 seconds", async ({ page }) => {
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => (release = resolve));
  await deviceOverUsb(page, async (frame) => {
    if (rpcCommandOf(frame) !== 1) return [];
    await wait;
    return [packet("state provisioned"), packet("empty result for wifi settings")];
  });
  await page.getByLabel("Network name").fill("HomeNet");
  await page.getByRole("button", { name: "Connect Zenit to this network" }).click();
  await expect(page.getByText("Connecting, up to 30 seconds. Keep the USB cable plugged in.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Zenit to this network" })).toBeDisabled();
  release();
  await expect(page.getByTestId("wifi-done")).toBeVisible();
});

test("says in plain words when the board could not connect", async ({ page }) => {
  await deviceOverUsb(page, (frame) =>
    rpcCommandOf(frame) === 1
      ? [packet("state provisioning"), packet("error unable to connect"), packet("state ready")]
      : [],
  );
  await page.getByLabel("Network name").fill("HomeNet");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Connect Zenit to this network" }).click();
  await expect(page.getByRole("alert")).toContainText("Zenit could not join that network.");
  await expect(page.getByRole("alert")).not.toContainText("wrong-password");
  // The person can try again
  await expect(page.getByRole("button", { name: "Connect Zenit to this network" })).toBeEnabled();
});

test("says when the board refuses the settings", async ({ page }) => {
  await deviceOverUsb(page, (frame) => (rpcCommandOf(frame) === 1 ? [packet("error invalid rpc")] : []));
  await page.getByLabel("Network name").fill("HomeNet");
  await page.getByRole("button", { name: "Connect Zenit to this network" }).click();
  await expect(page.getByRole("alert")).toContainText("Zenit did not accept that name or password.");
});

test("checks the name and the password before sending anything", async ({ page }) => {
  const { improv } = await deviceOverUsb(page, SCAN);
  const connect = page.getByRole("button", { name: "Connect Zenit to this network" });
  await connect.click();
  await expect(page.getByRole("alert")).toHaveText("Choose or type the name of your WiFi network.");
  await page.getByLabel("Network name").fill("HomeNet");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await connect.click();
  await expect(page.getByRole("alert")).toContainText("8 to 63 characters");
  expect(improv.frames()).toEqual([]);
});

test("shows and hides the password", async ({ page }) => {
  await deviceOverUsb(page, SCAN);
  const field = page.getByLabel("Password", { exact: true });
  await field.fill("correct-horse");
  await expect(field).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(field).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(field).toHaveAttribute("type", "password");
});

test("forgets the network after a confirmation", async ({ page }) => {
  const { mock } = await deviceOverUsb(page, SCAN);
  await page.getByRole("button", { name: "Forget this network" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Zenit leaves the network and turns its WiFi off.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(mock.commands()).not.toContain("wifi_forget");
  await page.getByRole("button", { name: "Forget this network" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Forget network" }).click();
  await expect(page.getByTestId("wifi-state")).toHaveText("Not set up. Zenit is not on a WiFi network.");
  expect(mock.commands()).toContain("wifi_forget");
  await expect(page.getByRole("button", { name: "Forget this network" })).toHaveCount(0);
});

test("changes the WiFi strength when it is chosen", async ({ page }) => {
  const { mock } = await deviceOverUsb(page, SCAN);
  await page.getByLabel("WiFi strength").selectOption("13");
  await expect.poll(() => mock.board.settings["wifi_power"]).toBe("13");
  expect(mock.commands().filter((command) => command === "settings_set")).toHaveLength(1);
});

test("over WiFi the card shows the state and sends the person to the USB cable", async ({ page }) => {
  await mockBoard(page, new FakeBoard().withNetwork());
  await page.goto("/");
  await page.getByLabel("Address of your Zenit").fill(MOCK_URL);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("link", { name: "Device" }).click();
  await expect(page.getByTestId("wifi-state")).toHaveText('Connected to "HomeNet".');
  await expect(page.getByTestId("wifi-usb-note")).toContainText("do it with the USB cable");
  await expect(page.getByTestId("wifi-setup")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Forget this network" })).toHaveCount(0);
});

test("a board from before the WiFi milestone has no WiFi card", async ({ page }) => {
  await mockBoard(page, new FakeBoard());
  await page.goto("/");
  await page.getByLabel("Address of your Zenit").fill(MOCK_URL);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("link", { name: "Device" }).click();
  await expect(page.getByRole("heading", { name: "Your Zenit" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "WiFi", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Firmware updates" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Update settings" })).toHaveCount(0);
});
