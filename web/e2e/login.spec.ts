// SPDX-License-Identifier: GPL-3.0-or-later

// The network login and the token, against the mock board (the simulator's token is not known over WiFi).

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { installFakeSerial } from "./fake-serial.ts";
import { MOCK_URL, MOCK_USB_URL, mockBoard } from "./mock-board.ts";
import { FakeBoard, TOKEN } from "../test/helpers.ts";

function protectedBoard(): FakeBoard {
  const board = new FakeBoard().withNetwork();
  board.settings["network_login"] = true;
  return board;
}

async function connectOverWifi(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Address of your Zenit").fill(MOCK_URL);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
}

test("asks for the token when the board wants it, and logs in", async ({ page }) => {
  const mock = await mockBoard(page, protectedBoard());
  await connectOverWifi(page);
  await expect(page.getByRole("heading", { name: "Log in to your Zenit" })).toBeVisible();
  await expect(page.getByText("The token has 16 letters and digits.")).toBeVisible();
  await expect(page.getByText("Log in needed")).toBeVisible();
  await page.getByLabel("Token").fill(TOKEN);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByTestId("connection")).toHaveText("Connected over WiFi");
  await expect(page.getByTestId("live-effect")).toBeVisible();
  expect(mock.commands()).toEqual(expect.arrayContaining(["auth_challenge", "auth", "settings_get", "status"]));
  // The token itself never crosses the network: the requests carry an HMAC, not the token
  expect(JSON.stringify(mock.board.requests)).not.toContain(TOKEN);
});

test("keeps the token only in memory", async ({ page }) => {
  await mockBoard(page, protectedBoard());
  await connectOverWifi(page);
  await page.getByLabel("Token").fill(TOKEN);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByTestId("connection")).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(TOKEN);
  expect(page.url()).not.toContain(TOKEN);
  await page.reload();
  await expect(page.getByLabel("Address of your Zenit")).toBeVisible();
});

test("says when the token is not right, and checks its shape before asking the board", async ({ page }) => {
  const mock = await mockBoard(page, protectedBoard());
  await connectOverWifi(page);
  await page.getByLabel("Token").fill("abc");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toContainText("16 characters");
  expect(mock.commands()).not.toContain("auth");
  await page.getByLabel("Token").fill("zzzzzzzzzzzzzzzz");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toContainText("That token is not right.");
  await expect(page.getByRole("heading", { name: "Log in to your Zenit" })).toBeVisible();
});

test("says the connection was closed after three wrong tokens", async ({ page }) => {
  await mockBoard(page, protectedBoard());
  await connectOverWifi(page);
  for (let i = 0; i < 3; i++) {
    await page.getByLabel("Token").fill("zzzzzzzzzzzzzzzz");
    await page.getByRole("button", { name: "Log in" }).click();
    if (i < 2) await expect(page.getByRole("alert")).toContainText("That token is not right.");
  }
  await expect(page.getByRole("alert")).toContainText("the access token was wrong three times");
  await expect(page.getByText("Connection lost")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect" })).toBeVisible();
});

test("says another page holds the board when the board closes the connection with 1013", async ({ page }) => {
  // The handshake is accepted, as a board's is, and the board closes the connection at once
  await page.routeWebSocket(MOCK_URL, (socket) =>
    socket.onMessage(() => void socket.close({ code: 1013, reason: "" })),
  );
  await connectOverWifi(page);
  await expect(page.getByRole("alert")).toContainText("Another page or phone is already connected to this Zenit.");
  await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toBeVisible();
});

test("warns before the login is turned on over WiFi, then asks for the token after reconnecting", async ({ page }) => {
  const mock = await mockBoard(page, new FakeBoard().withNetwork());
  await connectOverWifi(page);
  await page.getByRole("link", { name: "Device" }).click();
  await page.getByRole("switch", { name: /Ask for a token to log in/ }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Zenit closes this connection, and then asks for the token.");
  await expect(dialog).toContainText("Make sure you have the token before you continue.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(mock.commands()).not.toContain("settings_set");
  await page.getByRole("switch", { name: /Ask for a token to log in/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByRole("heading", { name: "Log in to your Zenit" })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Token").fill(TOKEN);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByTestId("connection")).toBeVisible();
  await page.getByRole("link", { name: "Device" }).click();
  await expect(page.getByRole("switch", { name: /Ask for a token to log in/ })).toBeChecked();
  expect(mock.connections()).toBe(2);
});

test("turns the login off without a warning over USB", async ({ page }) => {
  const mock = await mockBoard(page, protectedBoard());
  await installFakeSerial(page, MOCK_USB_URL);
  await page.goto("/");
  await page.getByRole("button", { name: "Connect with USB" }).click();
  await page.getByRole("link", { name: "Device" }).click();
  const login = page.getByRole("switch", { name: /Ask for a token to log in/ });
  await expect(login).toBeChecked();
  await login.click();
  await expect(login).not.toBeChecked();
  await expect.poll(() => mock.board.settings["network_login"]).toBe(false);
});

test.describe("the token over USB", () => {
  async function deviceOverUsb(page: Page) {
    const mock = await mockBoard(page, protectedBoard());
    await installFakeSerial(page, MOCK_USB_URL);
    await page.goto("/");
    await page.getByRole("button", { name: "Connect with USB" }).click();
    await expect(page.getByTestId("connection")).toHaveText("Connected by USB");
    await page.getByRole("link", { name: "Device" }).click();
    return mock;
  }

  test("is hidden until it is revealed, and can be copied", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await deviceOverUsb(page);
    await expect(page.getByTestId("token")).not.toContainText(TOKEN);
    await page.getByRole("button", { name: "Show token" }).click();
    await expect(page.getByTestId("token")).toHaveText(TOKEN);
    await page.getByRole("button", { name: "Hide token" }).click();
    await expect(page.getByTestId("token")).not.toContainText(TOKEN);
    await page.getByRole("button", { name: "Copy token" }).click();
    await expect(page.getByText("Copied.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(TOKEN);
  });

  test("is replaced after a confirmation that says every WiFi client logs in again", async ({ page }) => {
    const mock = await deviceOverUsb(page);
    await page.getByRole("button", { name: "Make a new token" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Every phone and computer that uses Zenit over WiFi has to log in again");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(mock.commands()).not.toContain("token_regenerate");
    await page.getByRole("button", { name: "Make a new token" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Make a new token" }).click();
    await page.getByRole("button", { name: "Show token" }).click();
    await expect(page.getByTestId("token")).toHaveText(mock.board.token);
    expect(mock.board.token).not.toBe(TOKEN);
  });

  test("is not shown over WiFi", async ({ page }) => {
    await mockBoard(page, new FakeBoard().withNetwork());
    await connectOverWifi(page);
    await page.getByRole("link", { name: "Device" }).click();
    await expect(page.getByTestId("token")).toHaveCount(0);
    await expect(page.getByTestId("token-usb-note")).toBeVisible();
    await expect(page.getByRole("button", { name: "Make a new token" })).toHaveCount(0);
  });
});

test("keeps the prompt and the typed text when the board closes the idle connection, then logs in by reconnecting", async ({
  page,
}) => {
  const mock = await mockBoard(page, protectedBoard());
  await connectOverWifi(page);
  await page.getByLabel("Token").fill(TOKEN.slice(0, 6));
  mock.drop(1008); // how the board closes a connection that did not log in
  await expect(page.getByText("Zenit closed the idle connection after 10 seconds.")).toBeVisible();
  await expect(page.getByLabel("Token")).toHaveValue(TOKEN.slice(0, 6));
  // Nothing reconnects while the prompt sits idle
  await page.waitForTimeout(1500);
  await expect(page.getByRole("heading", { name: "Log in to your Zenit" })).toBeVisible();
  await page.getByLabel("Token").fill(TOKEN);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByTestId("connection")).toHaveText("Connected over WiFi");
});
