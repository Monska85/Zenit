// SPDX-License-Identifier: GPL-3.0-or-later

import { collectErrors, connectByAddress, expect, test } from "./fixtures.ts";

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
  // The listeners are in place before the first request of the page, so nothing the page loads first is missed
  const site = new URL(test.info().project.use.baseURL!);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== site.origin && url.protocol !== "data:" && url.protocol !== "blob:") outside.push(request.url());
  });
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).href !== new URL(simulator.url).href) outside.push(socket.url());
  });
  await connectByAddress(page, simulator.url);
  await page.getByRole("radio", { name: "Breathing", exact: true }).check({ force: true });
  await page.getByRole("link", { name: "Device" }).click();
  await page.getByRole("button", { name: "Install or update firmware" }).click();
  await page.getByRole("alertdialog").getByLabel("The panel power socket is unplugged").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("esp-web-install-button")).toBeAttached();
  await page.getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy", level: 1 })).toBeVisible();
  expect(outside).toEqual([]);
});

test("a page loaded over https makes no probe request for a board", async ({ page }) => {
  const base = test.info().project.use.baseURL;
  const requests: string[] = [];
  await page.route("https://zenit-site.test/**", async (route) => {
    requests.push(new URL(route.request().url()).pathname);
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({ response: await route.fetch({ url: `${base}${path}` }) });
  });
  await page.goto("https://zenit-site.test/");
  await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toBeVisible();
  expect(requests).not.toContain("/board.json");
});

test("the page carries the content security policy that forbids outside requests", async ({ page }) => {
  const response = await page.goto("/");
  const html = await response!.text();
  const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];
  expect(policy).toBe(
    "default-src 'self'; connect-src 'self' ws:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'",
  );
});

test("an outside request is blocked by the policy", async ({ page }) => {
  // Were the policy missing, the request would reach this route and fail the test, never the internet
  const reached: string[] = [];
  await page.route("https://example.org/**", (route) => {
    reached.push(route.request().url());
    return route.abort();
  });
  await page.goto("/");
  const violation = await page.evaluate(async () => {
    const seen = new Promise<string>((resolve) =>
      document.addEventListener("securitypolicyviolation", (event) => resolve(event.effectiveDirective), {
        once: true,
      }),
    );
    await fetch("https://example.org/").catch(() => undefined);
    return seen;
  });
  expect(violation).toBe("connect-src");
  expect(reached).toEqual([]);
});

test("refuses an address outside the local network before opening anything", async ({ page }) => {
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto("/");
  for (const typed of ["203.0.113.5", "zenit.example.com", "ws://8.8.8.8:8765/ws", "wss://zenit-1a2b.local/ws"]) {
    await page.getByLabel("Address of your Zenit").fill(typed);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText(
      typed.startsWith("wss:")
        ? "The address must start with ws://."
        : /^This app connects only to a Zenit on your own network/,
    );
  }
  expect(sockets).toEqual([]);
});

test("shows only a notice when another site puts the app in a frame", async ({ page }) => {
  // Any page that frames the app: a plain file of the site holds the frame (Chrome's Local Network Access keeps a page
  // of another site from framing one on this computer, so the test cannot use one)
  await page.goto("/LICENSE.txt");
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.src = "/";
    frame.width = "600";
    frame.height = "400";
    document.body.append(frame);
  });
  const frame = page.frameLocator("iframe");
  await expect(frame.getByTestId("framed-notice")).toBeVisible();
  await expect(frame.getByRole("link", { name: "Open the Zenit app in its own tab" })).toHaveAttribute(
    "target",
    "_blank",
  );
  await expect(frame.getByRole("button")).toHaveCount(0);
});

test("raises no console error on any page", async ({ page, simulator }) => {
  const errors = collectErrors(page);
  await connectByAddress(page, simulator.url);
  for (const name of ["Device", "Privacy", "Light"]) await page.getByRole("link", { name }).click();
  expect(errors).toEqual([]);
});
