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
  await page.getByRole("radio", { name: "Breathing" }).check({ force: true });
  await expect(page.getByRole("slider", { name: "Length of a breath" })).toHaveAttribute("aria-valuetext", "8 s");
  await expect(page.getByRole("slider", { name: "Dimmest level" })).toHaveAttribute("aria-valuetext", "20 %");
});

test("the pages have one heading of level 1 each, and the navigation marks the current page", async ({
  page,
  simulator,
}) => {
  await connectByAddress(page, simulator.url);
  await expect(page.getByRole("link", { name: "Light" })).toHaveAttribute("aria-current", "page");
  for (const [link, heading] of [
    ["Device", "Device"],
    ["Privacy", "Privacy"],
  ] as const) {
    await page.getByRole("link", { name: link }).click();
    await expect(page.getByRole("link", { name: link })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
  }
});

test("the theme button cycles the theme, keeps it, and names its next state", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: /^Theme: Match my device/ }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: /^Theme: Light/ }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: /^Theme: Dark/ })).toBeVisible();
  await page.getByRole("button", { name: /^Theme: Dark/ }).click();
  await expect(page.getByRole("button", { name: /^Theme: Match my device/ })).toBeVisible();
});

test("follows the system theme, and its changes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
