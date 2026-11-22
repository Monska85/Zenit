// SPDX-License-Identifier: GPL-3.0-or-later

import { connectByAddress, expect, test } from "./fixtures.ts";

test("states what the app does with data, and links the license and the notices", async ({ page }) => {
  await page.goto("/#/privacy");
  await expect(page.getByText("This app sends nothing to any server on the internet.")).toBeVisible();
  await expect(page.getByTestId("app-version")).toHaveText(/^Version \d+\.\d+\.\d+/);
  for (const [name, path] of [
    ["License", "LICENSE.txt"],
    ["additional permission", "LICENSE-EXCEPTION.txt"],
    ["Third-party notices", "THIRD_PARTY_NOTICES.txt"],
  ] as const) {
    const link = page.getByRole("link", { name });
    await expect(link).toHaveAttribute("href", `./${path}`);
    const response = await page.request.get(`/${path}`);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/plain");
  }
  await expect(page.getByRole("link", { name: "Source code" })).toHaveAttribute(
    "href",
    /^https:\/\/github\.com\/[^/]+\/[^/]+$/,
  );
});

test("the notices list the bundled packages and the fixed entries", async ({ page }) => {
  const text = await (await page.request.get("/THIRD_PARTY_NOTICES.txt")).text();
  expect(text).toContain("Zenit web app: third-party notices");
  for (const name of [
    "react",
    "react-dom",
    "@radix-ui/react-slider",
    "lucide-react",
    "esp-web-tools",
    "esptool-js",
    "lit",
    "shadcn/ui",
    "esptool flasher stubs",
  ]) {
    expect(text, name).toContain(`. ${name}\n`);
  }
});

test("makes no request outside its own site and the board, over a whole visit", async ({ page, simulator }) => {
  const outside: string[] = [];
  await page.goto("/");
  const site = new URL(page.url());
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== site.origin && url.protocol !== "data:" && url.protocol !== "blob:") outside.push(request.url());
  });
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).href !== new URL(simulator.url).href) outside.push(socket.url());
  });
  await connectByAddress(page, simulator.url);
  await page.getByRole("radio", { name: "Breathing" }).check({ force: true });
  await page.getByRole("link", { name: "Device" }).click();
  await page.getByRole("button", { name: "Install or update firmware" }).click();
  await page.getByRole("alertdialog").getByLabel("The panel power socket is unplugged").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("esp-web-install-button")).toBeAttached();
  await page.getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy", level: 1 })).toBeVisible();
  expect(outside).toEqual([]);
});

test("the page carries the content security policy that forbids outside requests", async ({ page }) => {
  const response = await page.goto("/");
  const html = await response!.text();
  const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];
  expect(policy).toBe(
    "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'",
  );
});

test("an outside request is blocked by the policy", async ({ page }) => {
  await page.goto("/");
  const blocked = await page.evaluate(async () => {
    try {
      await fetch("https://example.org/");
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
});

test("raises no console error on any page", async ({ page, simulator }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await connectByAddress(page, simulator.url);
  for (const name of ["Device", "Privacy", "Light"]) await page.getByRole("link", { name }).click();
  expect(errors).toEqual([]);
});
