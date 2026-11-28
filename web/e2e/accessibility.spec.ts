// SPDX-License-Identifier: GPL-3.0-or-later

import { connectByAddress, expect, test } from "./fixtures.ts";

test("everything on the Light view can be reached and used with the keyboard", async ({ page, simulator }) => {
  await connectByAddress(page, simulator.url);
  // The power button is a toggle
  const power = page.getByRole("button", { name: "Light", exact: true });
  await power.focus();
  await page.keyboard.press("Space");
  await expect(power).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Space");
  await expect(power).toHaveAttribute("aria-pressed", "true");
  // The effects are radio buttons: the arrow keys move the choice
  await page.getByRole("radio", { name: "Steady" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("live-effect")).not.toHaveText("Steady");
});

test("every control has an accessible name and a focus ring", async ({ page, simulator }) => {
  await connectByAddress(page, simulator.url);
  const unnamed = await page.evaluate(() => {
    const names: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(
      "button, a[href], input, select, textarea, [role=slider]",
    )) {
      const label =
        element.getAttribute("aria-label") ??
        (element.id ? document.querySelector(`label[for="${element.id}"]`)?.textContent : null) ??
        element.closest("label")?.textContent ??
        element.textContent;
      if (!label || label.trim() === "") names.push(element.outerHTML.slice(0, 80));
    }
    return names;
  });
  expect(unnamed).toEqual([]);
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle);
  expect(outline).not.toBe("none");
});

test("sliders announce their value as text", async ({ page, simulator }) => {
  await connectByAddress(page, simulator.url);
  await expect(page.getByRole("slider", { name: "Brightness" })).toHaveAttribute("aria-valuetext", "60 %");
  await page.getByRole("radio", { name: "Breathing", exact: true }).check({ force: true });
  await expect(page.getByRole("slider", { name: "Length of a breath" })).toHaveAttribute("aria-valuetext", "8 s");
  await expect(page.getByRole("slider", { name: "Dimmest level" })).toHaveAttribute("aria-valuetext", "20 %");
});

test("the pages have one heading of level 1 each, and the navigation marks the current page", async ({
  page,
  simulator,
}) => {
  await connectByAddress(page, simulator.url);
  const nav = page.getByRole("navigation", { name: "Pages" });
  await expect(nav.getByRole("link")).toHaveText(["Light", "Device"]);
  await expect(nav.getByRole("link", { name: "Light" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "Device" }).click();
  await expect(nav.getByRole("link", { name: "Device" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Device");
  // Privacy is a link in the footer, one tap away from every page
  await page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Privacy" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.locator("[aria-current]")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy");
});

test("the header menu chooses the theme, keeps it, and closes with Escape", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const html = page.locator("html");
  const pill = page.getByRole("button", { name: "Connection: Not connected" });
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(pill).toHaveAttribute("aria-expanded", "false");
  await pill.click();
  await expect(pill).toHaveAttribute("aria-expanded", "true");
  const theme = page.getByRole("group", { name: "Theme" });
  await expect(theme.getByRole("radio", { name: "Match my device" })).toBeChecked();
  // Not connected: there is nothing to disconnect
  await expect(page.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
  await theme.getByRole("radio", { name: "Dark" }).check();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Escape");
  await expect(pill).toHaveAttribute("aria-expanded", "false");
  await expect(theme).toBeHidden();
  await expect(pill).toBeFocused();
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Connection: Not connected" }).click();
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  await page.getByRole("radio", { name: "Light" }).check();
  await expect(html).toHaveAttribute("data-theme", "light");
  // A click outside closes it
  await page.getByRole("heading", { name: "Connect to your Zenit" }).click();
  await expect(page.getByRole("group", { name: "Theme" })).toBeHidden();
});

test("the header menu names the board and disconnects from it", async ({ page, simulator }) => {
  await connectByAddress(page, simulator.url);
  const pill = page.getByRole("button", { name: /^Connection: WiFi/ });
  await expect(pill).toHaveAttribute("title", simulator.url);
  await pill.click();
  await expect(page.getByText(/^Connected over WiFi/)).toBeVisible();
  await page.getByRole("button", { name: "Disconnect" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toBeVisible();
  // The keyboard focus stays on the pill, not lost to the top of the page
  await expect(page.getByRole("button", { name: "Connection: Not connected" })).toBeFocused();
});

test("the tab bar is at the bottom of a phone screen and at the top of a wide one", async ({ page, simulator }) => {
  await page.setViewportSize({ width: 360, height: 700 });
  await connectByAddress(page, simulator.url);
  const nav = page.getByRole("navigation", { name: "Pages" });
  let box = await nav.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box!.y + box!.height)).toBe(700);
  expect(await nav.evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
  for (const link of await nav.getByRole("link").all()) {
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.setViewportSize({ width: 1024, height: 800 });
  box = await nav.boundingBox();
  const header = await page.locator("header").boundingBox();
  expect(box!.y).toBeLessThan(200);
  expect(box!.y).toBeGreaterThan(header!.y + header!.height - 1);
  expect(await nav.evaluate((element) => getComputedStyle(element).position)).toBe("static");
});

test("with reduced motion nothing moves; without it the previews and the lit button do", async ({
  page,
  simulator,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await connectByAddress(page, simulator.url);
  const breathing = page
    .getByRole("radio", { name: "Breathing", exact: true })
    .locator("..")
    .getByTestId("effect-preview");
  for (const element of [breathing, page.getByTestId("power-button")]) {
    const style = await element.evaluate((node) => getComputedStyle(node).animationName);
    expect(style).toBe("none");
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(await breathing.evaluate((node) => getComputedStyle(node).animationName)).toBe("preview-breathe");
  expect(await breathing.evaluate((node) => getComputedStyle(node).animationIterationCount)).toBe("infinite");
  expect(await page.getByTestId("power-button").evaluate((node) => getComputedStyle(node).animationName)).toBe("glow");
});

test("follows the system theme, and its changes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
