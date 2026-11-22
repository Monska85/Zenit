// SPDX-License-Identifier: GPL-3.0-or-later

import { connectByAddress, expect, test } from "./fixtures.ts";
import { MOCK_URL, mockBoard } from "./mock-board.ts";

test("connects to the simulator by address and lands on the Light view", async ({ page, simulator }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toBeVisible();
  await page.getByLabel("Address of your Zenit").fill(simulator.url);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByTestId("connection")).toHaveText("Connected over WiFi");
  await expect(page.getByTestId("connection")).toHaveAttribute("title", simulator.url);
  await expect(page.getByRole("button", { name: "Light", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("offers the address again the next time", async ({ page, simulator }) => {
  await connectByAddress(page, simulator.url);
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Address of your Zenit")).toHaveValue(simulator.url);
});

test("tells a person what is wrong with an address", async ({ page }) => {
  await page.goto("/");
  const connect = page.getByRole("button", { name: "Connect", exact: true });
  await connect.click();
  await expect(page.getByRole("alert")).toHaveText("Type the address of your Zenit.");
  await page.getByLabel("Address of your Zenit").fill("http://zenit.local");
  await connect.click();
  await expect(page.getByRole("alert")).toHaveText("The address must start with ws:// or wss://.");
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

test("shows the USB warning, and disables USB with a reason where the browser has no Web Serial", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "serial", { configurable: true, value: undefined });
  });
  await page.goto("/");
  await expect(page.getByText("Unplug the panel power socket before you connect the USB cable.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect with USB" })).toBeDisabled();
  await expect(page.getByText("This browser cannot use a USB cable.").first()).toBeVisible();
});

test("shows the other pages while not connected", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Device" }).click();
  await expect(page.getByRole("heading", { name: "Device", level: 1 })).toBeVisible();
  await expect(page.getByText("Connect to see your Zenit.")).toBeVisible();
  await page.getByRole("link", { name: "Privacy" }).click();
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

test("on a secure page of another site, says only USB reaches a Zenit and turns the address off", async ({
  page,
  baseURL,
}) => {
  // The app served from https://zenit-site.test, as the published site is: its files come from the test server
  await page.route("https://zenit-site.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({ response: await route.fetch({ url: `${baseURL}${path}` }) });
  });
  await page.goto("https://zenit-site.test/");
  await expect(page.getByText("From this page a Zenit is reached with the USB cable.")).toBeVisible();
  await expect(page.getByText("Over WiFi, open the Zenit's own address in the browser.")).toBeVisible();
  await expect(page.getByLabel("Address of your Zenit")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeDisabled();
});

test("on this computer, the address stays on and the note is not shown", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("From this page a Zenit is reached with the USB cable.")).toHaveCount(0);
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
