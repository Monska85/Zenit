// SPDX-License-Identifier: GPL-3.0-or-later

import type { Page } from "@playwright/test";
import { connectByAddress, expect, test } from "./fixtures.ts";
import { FakeBoard } from "../test/helpers.ts";
import { MOCK_URL, mockBoard } from "./mock-board.ts";

test("connects to the simulator by address and lands on the Light view", async ({ page, simulator }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toBeVisible();
  await page.getByLabel("Address of your Zenit").fill(simulator.url);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByTestId("connection")).toContainText("WiFi");
  await expect(page.getByRole("button", { name: /^Connection: WiFi/ })).toHaveAttribute("title", simulator.url);
  await expect(page.getByRole("button", { name: "Light", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("offers the address again the next time", async ({ page, simulator }) => {
  await connectByAddress(page, simulator.url);
  await page.getByRole("button", { name: /^Connection:/ }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toBeVisible();
  await page.reload();
  // The last board that worked is one tap away; the field is for another one
  const last = page.getByTestId("last-board");
  await expect(last.getByRole("heading")).toHaveText(simulator.url);
  await expect(page.getByLabel("Address of your Zenit")).toHaveValue("");
  await last.getByRole("button", { name: `Connect to ${simulator.url}` }).click();
  await expect(page.getByRole("button", { name: /^Connection: WiFi/ })).toBeVisible();
  await expect(page.getByTestId("live-state")).toBeVisible();
});

test("does not offer the simulator's address in the hint, but connects to it when typed", async ({
  page,
  simulator,
}) => {
  await page.goto("/");
  await expect(page.getByText("For example zenit-1a2b.local or 192.168.1.20.")).toBeVisible();
  await expect(page.getByText("127.0.0.1")).toHaveCount(0);
  await expect(page.getByTestId("last-board")).toHaveCount(0);
  await connectByAddress(page, simulator.url);
});

test("tells a person what is wrong with an address", async ({ page }) => {
  await page.goto("/");
  const connect = page.getByRole("button", { name: "Connect", exact: true });
  await connect.click();
  await expect(page.getByRole("alert")).toHaveText("Type the address of your Zenit.");
  await page.getByLabel("Address of your Zenit").fill("http://zenit.local");
  await connect.click();
  await expect(page.getByRole("alert")).toHaveText("The address must start with ws://.");
  await page.getByLabel("Address of your Zenit").fill("not an address");
  await connect.click();
  await expect(page.getByRole("alert")).toContainText("does not look like an address");
});

test("says so when nothing answers at the address", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Address of your Zenit").fill("ws://127.0.0.1:9");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert").first()).toContainText("Could not reach Zenit at that address");
  await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toBeVisible();
});

test("keeps offering the last address that worked after one that failed", async ({ page, simulator }) => {
  await connectByAddress(page, simulator.url);
  await page.getByRole("button", { name: /^Connection:/ }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByLabel("Address of your Zenit").fill("ws://127.0.0.1:9");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert").first()).toContainText("Could not reach Zenit at that address");
  await page.reload();
  await expect(page.getByTestId("last-board").getByRole("heading")).toHaveText(simulator.url);
});

test("shows the USB warning, and disables USB with a reason where the browser has no Web Serial", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "serial", { configurable: true, value: undefined });
  });
  await page.goto("/");
  // No Web Serial (most phones): the address comes first and the USB choice is folded, with its reason
  const folded = page.getByTestId("usb-folded");
  const address = page.getByLabel("Address of your Zenit");
  expect((await address.boundingBox())!.y).toBeLessThan((await folded.boundingBox())!.y);
  await expect(page.getByRole("button", { name: "Connect with USB" })).toBeHidden();
  await folded.getByText("With a USB cable").click();
  await expect(page.getByText("This browser cannot use a USB cable.").first()).toBeVisible();
  await expect(page.getByText("Unplug the panel power socket before you connect the USB cable.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect with USB" })).toBeDisabled();
});

test("with Web Serial, shows the USB choice first and open", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Unplug the panel power socket before you connect the USB cable.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect with USB" })).toBeEnabled();
  await expect(page.getByTestId("usb-folded")).toHaveCount(0);
  const usb = await page.getByRole("button", { name: "Connect with USB" }).boundingBox();
  expect(usb!.y).toBeLessThan((await page.getByLabel("Address of your Zenit").boundingBox())!.y);
});

test("shows the other pages while not connected", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Device" }).click();
  await expect(page.getByRole("heading", { name: "Device", level: 1 })).toBeVisible();
  await expect(page.getByText("Connect to see your Zenit.")).toBeVisible();
  await page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Light" }).click();
  await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toBeVisible();
});

test("shows the way to the firmware install from the Connect screen", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Install the firmware" }).click();
  await expect(page.getByRole("heading", { name: "Install or update the firmware" })).toBeVisible();
});

test("goes back to the Connect screen after disconnecting, and the Light view needs a connection", async ({
  page,
  simulator,
}) => {
  await connectByAddress(page, simulator.url);
  await page.getByRole("button", { name: /^Connection:/ }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toBeVisible();
  await page.goto("/#/light");
  await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toBeVisible();
});

test("shows Connecting while it waits for a board that is slow to answer", async ({ page }) => {
  await page.routeWebSocket(MOCK_URL, () => {
    // never answers
  });
  await page.goto("/");
  await page.getByLabel("Address of your Zenit").fill(MOCK_URL);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Waiting for Zenit...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect with USB" })).toBeDisabled();
});

test("refuses a board of another protocol with a sentence", async ({ page }) => {
  const mock = await mockBoard(page);
  const answer = mock.board.answer;
  mock.board.answer = (request) =>
    answer(request).map((reply) => ({ ...reply, ...(request["cmd"] === "info" ? { protocol: 2 } : {}) }));
  await page.goto("/");
  await page.getByLabel("Address of your Zenit").fill(MOCK_URL);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("newer protocol");
  await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toBeVisible();
});

/** Serves the app from https://zenit-site.test, as the published site is: its files come from the test server. */
async function openSecureSite(page: Page, baseURL: string | undefined): Promise<void> {
  await page.route("https://zenit-site.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({ response: await route.fetch({ url: `${baseURL}${path}` }) });
  });
  await page.goto("https://zenit-site.test/");
}

const ASKS_FIRST = "The first time, Chrome asks to let this page find devices on your local network: allow it.";

test("on a secure page of another site in Chrome, reaches a Zenit by its .local name", async ({ page, baseURL }) => {
  await mockBoard(page, new FakeBoard().withNetwork(), ["ws://zenit-a1b2.local/ws"]);
  await openSecureSite(page, baseURL);
  await expect(page.getByText(ASKS_FIRST)).toBeVisible();
  await expect(page.getByText("This browser does not let this page reach a Zenit over WiFi.")).toHaveCount(0);
  await page.getByLabel("Address of your Zenit").fill("zenit-a1b2.local");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByTestId("connection")).toContainText("WiFi");
});

test("on a secure page of another site in Chrome, refuses a name that is not on the local network", async ({
  page,
  baseURL,
}) => {
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await openSecureSite(page, baseURL);
  await page.getByLabel("Address of your Zenit").fill("zenit.lan");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(/^This app connects only to a Zenit on your own network/);
  expect(sockets).toEqual([]);
});

test("on a secure page of another site in Chrome, a failed connection says to allow the local network", async ({
  page,
  baseURL,
}) => {
  await page.routeWebSocket("ws://192.168.1.20/ws", (socket) => void socket.close({ code: 1006, reason: "" }));
  await openSecureSite(page, baseURL);
  await page.getByLabel("Address of your Zenit").fill("192.168.1.20");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "If Chrome asked to let this page find devices on your local network, allow it and connect again.",
  );
});

test("on a secure page of another site in a browser without Local Network Access, turns the address off", async ({
  page,
  baseURL,
}) => {
  // Firefox and Safari: no navigator.userAgentData
  await page.addInitScript(() => {
    delete (Navigator.prototype as { userAgentData?: unknown }).userAgentData;
  });
  await openSecureSite(page, baseURL);
  await expect(page.getByText("This browser does not let this page reach a Zenit over WiFi.")).toBeVisible();
  await expect(page.getByText(ASKS_FIRST)).toHaveCount(0);
  await expect(page.getByLabel("Address of your Zenit")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeDisabled();
});

test("on this computer, the address stays on and the note is not shown", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("This browser does not let this page reach a Zenit over WiFi.")).toHaveCount(0);
  await expect(page.getByText(ASKS_FIRST)).toHaveCount(0);
  await expect(page.getByLabel("Address of your Zenit")).toBeEnabled();
});

test("ignores a second connection while one is opening, with both Connect buttons off", async ({ page }) => {
  await page.routeWebSocket(MOCK_URL, () => {
    // never answers: the connection stays opening
  });
  await page.goto("/");
  await page.getByLabel("Address of your Zenit").fill(MOCK_URL);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect with USB" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeDisabled();
});
