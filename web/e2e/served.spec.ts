// SPDX-License-Identifier: GPL-3.0-or-later

// The app served by a board: the simulator's bridge serves the built app and /board.json on its own port, as a board does,
// and the page opened from there finds the board by itself.

import { expect, test } from "./fixtures.ts";
import { mockBoard } from "./mock-board.ts";
import { FakeBoard } from "../test/helpers.ts";

test("finds the board that served it and connects by itself, with no Connect screen", async ({
  page,
  servedSimulator,
}) => {
  await page.goto(`${servedSimulator.origin}/`);
  await expect(page.getByTestId("connection")).toHaveText("Connected over WiFi");
  await expect(page.getByTestId("hostname")).toHaveText("zenit-0000");
  await expect(page.getByRole("button", { name: "Light", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toHaveCount(0);
  // There is no other board to connect to: no way to disconnect
  await expect(page.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
});

test("controls the light as over any other connection", async ({ page, servedSimulator }) => {
  await page.goto(`${servedSimulator.origin}/`);
  await expect(page.getByTestId("connection")).toBeVisible();
  await page.getByRole("radio", { name: "Breathing" }).check({ force: true });
  await expect(page.getByTestId("live-effect")).toHaveText("Breathing");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.getByTestId("power-state")).toHaveText("Off");
});

test("hides the installer and the USB option, and says why", async ({ page, servedSimulator }) => {
  await page.goto(`${servedSimulator.origin}/#/device`);
  await expect(page.getByTestId("connection")).toBeVisible();
  await expect(page.getByTestId("install-served-note")).toContainText("needs a page from the internet");
  await expect(page.getByRole("button", { name: "Install or update firmware" })).toHaveCount(0);
  await expect(page.getByTestId("firmware-published")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect with USB" })).toHaveCount(0);
});

test("shows the WiFi and update state of the simulator, and sends USB-only actions to the cable", async ({
  page,
  servedSimulator,
}) => {
  await page.goto(`${servedSimulator.origin}/#/device`);
  await expect(page.getByTestId("wifi-state")).toHaveText("Not set up. Zenit is not on a WiFi network.");
  await expect(page.getByTestId("wifi-usb-note")).toBeVisible();
  await expect(page.getByTestId("update-result")).toHaveText("Zenit has not looked for an update yet.");
  await expect(page.getByRole("button", { name: "Check now" })).toBeDisabled();
  await expect(page.getByText("Zenit needs WiFi to look for and install updates.")).toBeVisible();
  await expect(page.getByTestId("token-usb-note")).toBeVisible();
  await expect(page.getByTestId("token")).toHaveCount(0);
  await expect(page.getByText("Resetting needs a USB cable.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset to defaults" })).toHaveCount(0);
});

test("changes a board setting when it is chosen, and the board keeps it", async ({ page, servedSimulator }) => {
  // The board's answers, to know that each choice reached it before the page is reloaded
  const answers: string[] = [];
  page.on("websocket", (socket) => socket.on("framereceived", (frame) => answers.push(String(frame.payload))));
  await page.goto(`${servedSimulator.origin}/#/device`);
  await expect(page.getByTestId("connection")).toBeVisible();
  await page.getByLabel("WiFi strength").selectOption("13");
  await page.getByRole("radio", { name: "Tell me" }).check({ force: true });
  await expect(page.getByTestId("update-mode-hint")).toContainText("tells you");
  await page.getByLabel("Time zone", { exact: true }).selectOption({ label: "Rome, Paris, Berlin, Madrid" });
  await expect.poll(() => answers.some((answer) => answer.includes('"timezone":"CET-1CEST'))).toBe(true);
  await page.reload();
  await expect(page.getByLabel("WiFi strength")).toHaveValue("13");
  await expect(page.getByRole("radio", { name: "Tell me" })).toBeChecked();
  await expect(page.getByLabel("Time zone", { exact: true })).toHaveValue("CET-1CEST,M3.5.0,M10.5.0/3");
});

test("asks for the token after the login is turned on, and says so when it is wrong three times", async ({
  page,
  servedSimulator,
}) => {
  await page.goto(`${servedSimulator.origin}/#/device`);
  await expect(page.getByTestId("connection")).toBeVisible();
  await page.getByRole("switch", { name: /Ask for a token to log in/ }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Zenit closes this connection, and then asks for the token.");
  await dialog.getByRole("button", { name: "Turn on" }).click();
  // The board closes the connection; the page opens it again by itself and the board wants the token
  await expect(page.getByRole("heading", { name: "Log in to your Zenit" })).toBeVisible({ timeout: 15_000 });
  const token = page.getByLabel("Token");
  await token.fill("short");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toContainText("16 characters");
  for (let i = 0; i < 2; i++) {
    await token.fill("zzzzzzzzzzzzzzzz");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert")).toContainText("That token is not right.");
  }
  await token.fill("zzzzzzzzzzzzzzzz");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Zenit closed the connection: the access token was wrong three times")).toBeVisible();
  await expect(page.getByText("Connection lost")).toBeVisible();
  // The token is never stored
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain("zzzz");
});

test("makes no request outside its own origin, the board's own WebSocket included", async ({
  page,
  servedSimulator,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto(`${servedSimulator.origin}/`);
  await expect(page.getByTestId("connection")).toBeVisible();
  for (const name of ["Device", "Privacy", "Light"]) await page.getByRole("link", { name }).click();
  const origin = new URL(servedSimulator.origin).origin;
  expect(requests.filter((url) => new URL(url).origin !== origin && !url.startsWith("data:"))).toEqual([]);
  expect(requests.filter((url) => url.endsWith("/board.json"))).toEqual([`${origin}/board.json`]);
  expect(sockets).toEqual([`${servedSimulator.url}/ws`]);
});

test("is not served when /board.json is not a Zenit's answer", async ({ page }) => {
  await page.route("**/board.json", (route) =>
    route.fulfill({ contentType: "application/json", body: '{"zenit":true,"hostname":"evil","ws":"/ws"}' }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect with USB" })).toBeVisible();
  await expect(page.getByTestId("hostname")).toHaveCount(0);
});

test("a page that a board serves connects only to that board, though a Zenit answer comes from the same port", async ({
  page,
}) => {
  // A well-formed answer from a plain site: the page tries the board's WebSocket at its own address
  await page.route("**/board.json", (route) =>
    route.fulfill({ contentType: "application/json", body: '{"zenit":true,"hostname":"zenit-1234","ws":"/ws"}' }),
  );
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your Zenit" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Could not reach this Zenit.");
  expect(sockets).toEqual(["ws://localhost:4173/ws"]);
  // The page offers to try again
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
});

test("loads itself again when the board that served it installed a new app (close status 1012)", async ({ page }) => {
  await page.route("**/board.json", (route) =>
    route.fulfill({ contentType: "application/json", body: '{"zenit":true,"hostname":"zenit-1234","ws":"/ws"}' }),
  );
  const mock = await mockBoard(page, new FakeBoard().withNetwork(), ["ws://localhost:4173/ws"]);
  await page.goto("/");
  await expect(page.getByTestId("connection")).toHaveText("Connected over WiFi");
  await page.evaluate(() => ((window as unknown as { zenitBefore: boolean }).zenitBefore = true));
  const loaded = page.waitForEvent("load");
  mock.drop(1012);
  await loaded;
  expect(await page.evaluate(() => (window as unknown as { zenitBefore?: boolean }).zenitBefore)).toBeUndefined();
  await expect(page.getByTestId("connection")).toHaveText("Connected over WiFi");
});
