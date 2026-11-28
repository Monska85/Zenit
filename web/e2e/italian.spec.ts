// SPDX-License-Identifier: GPL-3.0-or-later

// The app in Italian, for a browser whose language is Italian, against a scripted board: the main paths, an error
// sentence, and the language choice of the status panel, which changes the page at once and keeps the connection.

import type { Page } from "@playwright/test";
import { FakeBoard } from "../test/helpers.ts";
import { textsOf } from "./catalog.ts";
import { expect, test } from "./fixtures.ts";
import { MOCK_URL, mockBoard } from "./mock-board.ts";

const it = textsOf("it");
const en = textsOf("en");

test.use({ locale: "it-IT" });

async function connect(page: Page, board = new FakeBoard().withFavorites()) {
  const mock = await mockBoard(page, board);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: it("connect:title") })).toBeVisible();
  await page.getByLabel(it("connect:address.label")).fill(MOCK_URL);
  await page.getByRole("button", { name: it("connect:connect"), exact: true }).click();
  await expect(page.getByTestId("live-state")).toBeVisible();
  return mock;
}

/** Opens the status panel and picks a language: "en", "it", or "system" for "Match my device". */
async function chooseLanguage(page: Page, value: string) {
  await page.getByTestId("connection").click();
  await page.locator(`input[name=language][value=${value}]`).check();
  await page.keyboard.press("Escape");
}

test("connects, and shows the Light view in Italian with <html lang>", async ({ page }) => {
  await connect(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  await expect(
    page.getByRole("button", { name: new RegExp(`^${it("common:status.label", { text: "WiFi" })}`) }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: it("light:view.effectTitle"), exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: it("common:tabs.light") })).toBeVisible();
  await page.getByRole("radio", { name: it("light:effects.breathing.label"), exact: true }).check({ force: true });
  await expect(page.getByTestId("live-effect")).toHaveText(it("light:effects.breathing.label"));
});

test("applies a favorite and confirms it in Italian; the board's names stay as they are", async ({ page }) => {
  await connect(page);
  const card = page.getByRole("region", { name: it("favorites:card.title"), exact: true });
  await card.getByRole("button", { name: /^Christmas(,|$)/ }).click();
  await expect(page.getByTestId("bottom-message")).toHaveText(it("favorites:done.applied", { name: "Christmas" }));
});

test("says each sentence with an element inside it as one Italian sentence", async ({ page }) => {
  await mockBoard(page, new FakeBoard().withFavorites().withNetwork());
  await page.goto("/");
  const install = it("connect:install.text", { link: it("connect:install.link") });
  await expect(page.getByText(install, { exact: true })).toBeVisible();
  await page.getByLabel(it("connect:address.label")).fill(MOCK_URL);
  await page.getByRole("button", { name: it("connect:connect"), exact: true }).click();
  await expect(page.getByTestId("live-state")).toHaveText(
    it("light:hero.line", { color: it("light:colors.white"), effect: it("light:effects.static.label") }),
  );
  await page.getByTestId("connection").click();
  await expect(
    page.getByText(it("common:status.connectedWifiTo", { name: "zenit-a1b2" }), { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: it("common:footer.privacy") }).click();
  const license = it("privacy:about.licenseLine", {
    license: it("privacy:about.license"),
    permission: it("privacy:about.permission"),
  });
  await expect(page.getByRole("listitem").filter({ hasText: license })).toHaveText(license);
});

test("shows the Device page in Italian", async ({ page }) => {
  await connect(page, new FakeBoard().withFavorites().withNetwork());
  await page.getByRole("link", { name: it("common:tabs.device") }).click();
  await expect(page.getByRole("heading", { name: it("device:view.title"), level: 1 })).toBeVisible();
  await expect(page.getByText(it("device:board.title"), { exact: true })).toBeVisible();
  await expect(page.getByText(it("device:firmware.title"), { exact: true }).first()).toBeVisible();
});

test("says an error code of the board in Italian", async ({ page }) => {
  const mock = await connect(page);
  mock.board.errors.set("settings_set", "bad_request");
  await page.getByRole("radio", { name: it("light:effects.twinkle.label"), exact: true }).check({ force: true });
  await expect(page.getByRole("alert")).toHaveText(it("errors:board.bad_request"));
});

test("switches language at once, keeps the connection and what is on screen, and remembers the choice", async ({
  page,
}) => {
  const mock = await connect(page);
  mock.board.errors.set("settings_set", "bad_request");
  await page.getByRole("radio", { name: it("light:effects.twinkle.label"), exact: true }).check({ force: true });
  await expect(page.getByRole("alert")).toHaveText(it("errors:board.bad_request"));
  const opened = mock.commands().filter((command) => command === "info").length;

  await chooseLanguage(page, "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("region", { name: en("light:view.effectTitle"), exact: true })).toBeVisible();
  // A message already on screen follows the language too
  await expect(page.getByRole("alert")).toHaveText(en("errors:board.bad_request"));
  expect(mock.commands().filter((command) => command === "info").length).toBe(opened);
  await expect(page.getByTestId("live-state")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: en("connect:title") })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await chooseLanguage(page, "system");
  await expect(page.getByRole("heading", { name: it("connect:title") })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  await chooseLanguage(page, "en");
  await chooseLanguage(page, "it");
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  expect(await page.evaluate(() => localStorage.getItem("zenit.language"))).toBe("it");
});

test("names each language in its own language, whatever the page's language", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("connection").click();
  const group = page.getByRole("group", { name: it("common:language.legend") });
  await expect(group.getByRole("radio")).toHaveCount(3);
  await expect(group.locator("label[lang=en]")).toHaveText("English");
  await expect(group.locator("label[lang=it]")).toHaveText("Italiano");
});
