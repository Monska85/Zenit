// SPDX-License-Identifier: GPL-3.0-or-later

// The Favorites card against the simulator, where favorites are real (the two ready-made ones, saved in its memory), and
// against a scripted board for what the simulator cannot be made to do (a refusal, a lost connection, a board without
// favorites).

import type { Locator, Page } from "@playwright/test";
import { FakeBoard } from "../test/helpers.ts";
import { connectByAddress, expect, test } from "./fixtures.ts";
import { MOCK_URL, mockBoard } from "./mock-board.ts";

const card = (page: Page): Locator => page.getByRole("region", { name: "Favorites", exact: true });
const tile = (page: Page, name: string): Locator =>
  card(page).getByRole("button", { name: new RegExp(`^${name}(,|$)`) });
const message = (page: Page): Locator => page.getByTestId("bottom-message");
const saveButton = (page: Page): Locator => card(page).getByRole("button", { name: "Save this light" });
const editButton = (page: Page): Locator => card(page).getByRole("button", { name: "Edit", exact: true });
const dialog = (page: Page, name: string): Locator => page.getByRole("dialog", { name, exact: true });

/** Opens the sheet of a favorite: Edit, then its row. */
async function openSheet(page: Page, name: string): Promise<Locator> {
  await editButton(page).click();
  await dialog(page, "Edit favorites").getByRole("button", { name, exact: true }).click();
  const sheet = dialog(page, name);
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Saves the light as it is now under `name`. */
async function save(page: Page, name: string): Promise<void> {
  await saveButton(page).click();
  const form = dialog(page, "Save this light");
  await form.getByLabel("Name").fill(name);
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toBeHidden();
}

async function connectMock(page: Page, board: FakeBoard) {
  const mock = await mockBoard(page, board);
  await page.goto("/");
  await page.getByLabel("Address of your Zenit").fill(MOCK_URL);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByTestId("live-state")).toBeVisible();
  return mock;
}

test.describe("on the simulator", () => {
  test.beforeEach(async ({ page, simulator }) => {
    await connectByAddress(page, simulator.url);
  });

  test("shows the card under the first card and above the effects, with the two ready-made favorites", async ({
    page,
  }) => {
    await expect(card(page)).toBeVisible();
    await expect(card(page).locator("button[data-testid=favorite-tile]")).toHaveText(["Starry night", "Christmas"]);
    const hero = (await page.getByTestId("power-button").boundingBox())!;
    const favorites = (await card(page).boundingBox())!;
    const effects = (await page.getByRole("region", { name: "Effect", exact: true }).boundingBox())!;
    expect(favorites.y).toBeGreaterThan(hero.y + hero.height);
    expect(favorites.y + favorites.height).toBeLessThan(effects.y);
    // The light is Steady: neither is showing
    await expect(card(page).getByText("On now")).toHaveCount(0);
    await expect(card(page).getByText("Turns on with this")).toHaveCount(0);
  });

  test("a tap applies a favorite, marks it, says so, and the mark follows the light", async ({ page }) => {
    await tile(page, "Christmas").click();
    await expect(page.getByTestId("live-effect")).toHaveText("Christmas");
    await expect(tile(page, "Christmas")).toHaveAccessibleName("Christmas, on now");
    await expect(tile(page, "Christmas").getByText("On now")).toBeVisible();
    await expect(message(page)).toHaveText("Christmas is on.");
    // The confirmation goes by itself
    await expect(message(page)).toHaveCount(0, { timeout: 8000 });
    // Anything that changes the look takes the mark away
    await page.getByRole("radio", { name: "Steady", exact: true }).check({ force: true });
    await expect(tile(page, "Christmas")).toHaveAccessibleName("Christmas");
    await tile(page, "Christmas").click();
    await expect(tile(page, "Christmas")).toHaveAccessibleName("Christmas, on now");
    await page.getByRole("radio", { name: "Ice" }).check({ force: true });
    await expect(tile(page, "Christmas")).toHaveAccessibleName("Christmas");
  });

  test("the light turned off shows no favorite", async ({ page }) => {
    await tile(page, "Christmas").click();
    await expect(tile(page, "Christmas")).toHaveAccessibleName("Christmas, on now");
    await page.getByTestId("power-button").click();
    await expect(page.getByTestId("live-state")).toHaveText("Off");
    await expect(tile(page, "Christmas")).toHaveAccessibleName("Christmas");
    await expect(card(page).getByText("On now")).toHaveCount(0);
  });

  test("saves the light with a name, the new favorite is last and marked", async ({ page }) => {
    await saveButton(page).click();
    const form = dialog(page, "Save this light");
    await expect(form).toBeVisible();
    const name = form.getByLabel("Name");
    // The effect's name, selected so typing replaces it, and the hint
    await expect(name).toHaveValue("Steady");
    await expect(name).toBeFocused();
    expect(await name.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([
      0, 6,
    ]);
    await expect(form.getByText("Up to 20 characters.")).toBeVisible();
    await page.keyboard.type("Bedtime");
    await page.keyboard.press("Enter");
    await expect(form).toBeHidden();
    await expect(card(page).locator("button[data-testid=favorite-tile]")).toHaveText([
      "Starry night",
      "Christmas",
      "BedtimeOn now",
    ]);
    await expect(tile(page, "Bedtime")).toHaveAccessibleName("Bedtime, on now");
    await expect(message(page)).toHaveText("Saved Bedtime.");
    await expect(saveButton(page)).toBeFocused();
  });

  test("the default name counts up while a favorite has it", async ({ page }) => {
    await save(page, "Steady");
    await saveButton(page).click();
    await expect(dialog(page, "Save this light").getByLabel("Name")).toHaveValue("Steady 2");
    await page.keyboard.press("Escape");
    await expect(dialog(page, "Save this light")).toBeHidden();
    await expect(saveButton(page)).toBeFocused();
  });

  test("tells what is wrong with a name next to the field, and clears it when typing", async ({ page }) => {
    await saveButton(page).click();
    const form = dialog(page, "Save this light");
    const name = form.getByLabel("Name");
    const problem = form.getByRole("alert");
    const press = () => form.getByRole("button", { name: "Save", exact: true }).click();
    await name.fill("   ");
    await press();
    await expect(problem).toHaveText("Give your favorite a name.");
    await name.fill("x");
    await expect(problem).toHaveCount(0);
    await name.fill("christmas");
    await press();
    await expect(problem).toHaveText("You already have a favorite called Christmas. Choose another name.");
    await name.fill("a​b");
    await press();
    await expect(problem).toHaveText("That name has a character Zenit cannot keep. Try letters, numbers and spaces.");
    // The field stops at 20 characters, counted as the board counts them: an emoji is one
    await name.fill("\u{1f31f}".repeat(25));
    await expect(name).toHaveValue("\u{1f31f}".repeat(20));
    await name.fill("  Café \u{1f319}  ");
    await press();
    await expect(form).toBeHidden();
    await expect(tile(page, "Café \u{1f319}")).toBeVisible();
  });

  test("renames from the sheet, with the same checks, and Done goes back to the list", async ({ page }) => {
    const sheet = await openSheet(page, "Starry night");
    // Name is the first control
    await expect(sheet.getByLabel("Name")).toBeFocused();
    await sheet.getByLabel("Name").fill("christmas");
    await sheet.getByRole("button", { name: "Rename" }).click();
    await expect(sheet.getByRole("alert")).toHaveText(
      "You already have a favorite called Christmas. Choose another name.",
    );
    await sheet.getByLabel("Name").fill("Night sky");
    await sheet.getByRole("button", { name: "Rename" }).click();
    // The confirmation is in the sheet, which is all that can be seen and heard while it is open
    await expect(dialog(page, "Night sky").getByRole("status")).toHaveText("Renamed to Night sky.");
    await expect(message(page)).toHaveCount(0);
    await expect(dialog(page, "Night sky")).toBeVisible();
    await dialog(page, "Night sky").getByRole("button", { name: "Done" }).click();
    await expect(dialog(page, "Edit favorites").getByRole("button", { name: "Night sky" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog(page, "Edit favorites")).toBeHidden();
    await expect(editButton(page)).toBeFocused();
    await expect(tile(page, "Night sky")).toBeVisible();
    await expect(tile(page, "Starry night")).toHaveCount(0);
  });

  test("uses the light as it is now for a favorite", async ({ page }) => {
    await page.getByRole("radio", { name: "Twinkle", exact: true }).check({ force: true });
    const sheet = await openSheet(page, "Starry night");
    await expect(sheet.getByText("Starry night will show the light you see now.")).toBeVisible();
    await sheet.getByRole("button", { name: "Use the light as it is now" }).click();
    await expect(sheet.getByRole("status")).toHaveText("Updated Starry night.");
    await expect(message(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(tile(page, "Starry night")).toHaveAccessibleName("Starry night, on now");
  });

  test("turns on with a favorite: the mark moves, the Power button brings its look, and the last light comes back", async ({
    page,
  }) => {
    let sheet = await openSheet(page, "Christmas");
    const turnOn = sheet.getByRole("switch", { name: "Turn on with this" });
    await expect(turnOn).not.toBeChecked();
    await expect(
      sheet.getByText("Zenit shows Christmas when it gets power and when you turn the light on."),
    ).toBeVisible();
    await expect(sheet.getByText(/this moves it here/)).toHaveCount(0);
    await turnOn.click({ force: true });
    await expect(sheet.getByRole("status")).toHaveText("Zenit turns on with Christmas.");
    await expect(message(page)).toHaveCount(0);
    await expect(turnOn).toBeChecked();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(tile(page, "Christmas")).toHaveAccessibleName("Christmas, turns on with this");
    await expect(tile(page, "Christmas").getByText("Turns on with this")).toBeVisible();
    // Another favorite says it moves the mark
    sheet = await openSheet(page, "Starry night");
    await expect(sheet.getByText("Now Christmas has it; this moves it here.")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    // The Power button: off, then on, and the light shows Christmas
    await page.getByTestId("power-button").click();
    await expect(page.getByTestId("live-state")).toHaveText("Off");
    await page.getByTestId("power-button").click();
    await expect(page.getByTestId("live-effect")).toHaveText("Christmas");
    await expect(tile(page, "Christmas")).toHaveAccessibleName("Christmas, on now, turns on with this");
    // And the last light again
    sheet = await openSheet(page, "Christmas");
    await sheet.getByRole("switch", { name: "Turn on with this" }).click({ force: true });
    await expect(sheet.getByRole("status")).toHaveText("Zenit turns on with the last light.");
    await expect(sheet.getByRole("switch", { name: "Turn on with this" })).not.toBeChecked();
  });

  test("deletes a favorite after a question, and the card is empty without any", async ({ page }) => {
    const sheet = await openSheet(page, "Starry night");
    await sheet.getByRole("button", { name: "Delete" }).click();
    const question = page.getByRole("alertdialog");
    await expect(question.getByText("Delete Starry night?")).toBeVisible();
    await expect(question.getByText("You can save a new favorite any time.")).toBeVisible();
    await question.getByRole("button", { name: "Cancel" }).click();
    await expect(question).toBeHidden();
    await expect(sheet).toBeVisible();
    // Escape on the question closes it and not the sheet under it
    await sheet.getByRole("button", { name: "Delete" }).click();
    await expect(question).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(question).toBeHidden();
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Delete" }).click();
    await question.getByRole("button", { name: "Delete" }).click();
    await expect(sheet).toBeHidden();
    // Back to the list, which is on top now: the confirmation is in it, and not behind it
    const list = dialog(page, "Edit favorites");
    await expect(list).toBeVisible();
    await expect(list.getByRole("status")).toHaveText("Deleted Starry night.");
    await expect(message(page)).toHaveCount(0);
    await expect(list.getByRole("button", { name: "Starry night" })).toHaveCount(0);
    await list.getByRole("button", { name: "Christmas" }).click();
    await dialog(page, "Christmas").getByRole("button", { name: "Delete" }).click();
    await question.getByRole("button", { name: "Delete" }).click();
    await expect(message(page)).toHaveText("Deleted Christmas.");
    // Nothing left to edit
    await expect(list).toBeHidden();
    await expect(page.getByTestId("favorites-empty")).toHaveText(
      "Save the light you like, then bring it back with one tap.",
    );
    await expect(saveButton(page)).toBeVisible();
    await expect(editButton(page)).toHaveCount(0);
  });

  test("keeps six favorites: a full dialog replaces one and keeps its name and mark", async ({ page }) => {
    let sheet = await openSheet(page, "Christmas");
    await sheet.getByRole("switch", { name: "Turn on with this" }).click({ force: true });
    await expect(sheet.getByRole("status")).toHaveText("Zenit turns on with Christmas.");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.getByRole("radio", { name: "Breathing", exact: true }).check({ force: true });
    for (const name of ["Bedtime", "Reading", "Bath time", "Party"]) await save(page, name);
    await expect(card(page).locator("button[data-testid=favorite-tile]")).toHaveCount(6);
    await saveButton(page).click();
    const full = dialog(page, "Your favorites are full");
    await expect(full).toBeVisible();
    await expect(
      full.getByText(
        "Zenit keeps up to 6 favorites. Choose one to replace with this light, or delete one first in Edit.",
      ),
    ).toBeVisible();
    await expect(full.getByRole("radio")).toHaveCount(6);
    const replace = full.getByRole("button", { name: "Replace" });
    await expect(replace).toBeDisabled();
    // Switch to another look so the replacement is visible
    await full.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("radio", { name: "Twinkle", exact: true }).check({ force: true });
    await saveButton(page).click();
    await full.getByRole("radio", { name: "Christmas" }).check({ force: true });
    await replace.click();
    await expect(full).toBeHidden();
    await expect(message(page)).toHaveText("Updated Christmas.");
    await expect(card(page).locator("button[data-testid=favorite-tile]")).toHaveCount(6);
    await expect(tile(page, "Christmas")).toHaveAccessibleName("Christmas, on now, turns on with this");
    // Delete one, and the dialog to save is the small one again
    sheet = await openSheet(page, "Party");
    await sheet.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(dialog(page, "Edit favorites").getByRole("status")).toHaveText("Deleted Party.");
    await page.keyboard.press("Escape");
    await saveButton(page).click();
    await expect(dialog(page, "Save this light")).toBeVisible();
  });

  test("the whole path works with the keyboard", async ({ page }) => {
    await tile(page, "Christmas").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("live-effect")).toHaveText("Christmas");
    // The tab order is the tiles, then Save this light, then Edit
    await page.keyboard.press("Tab");
    await expect(saveButton(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(editButton(page)).toBeFocused();
    await page.keyboard.press("Enter");
    const list = dialog(page, "Edit favorites");
    await expect(list.getByRole("button", { name: "Starry night" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog(page, "Starry night").getByLabel("Name")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog(page, "Starry night")).toBeHidden();
    await expect(list.getByRole("button", { name: "Starry night" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(editButton(page)).toBeFocused();
  });

  test("the previews are still with reduced motion and move without it", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const dot = tile(page, "Starry night").getByTestId("favorite-preview");
    expect(await dot.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(await dot.evaluate((node) => getComputedStyle(node).animationName)).toBe("preview-shooting-star");
  });

  test("a name is shown as plain text, never as markup", async ({ page }) => {
    await save(page, "<b>Bold</b>");
    await expect(tile(page, "<b>Bold</b>")).toBeVisible();
    await expect(card(page).locator("b")).toHaveCount(0);
  });
});

test("turns on with its favorite after the board restarts", async ({ page, controlledSimulator }) => {
  await connectByAddress(page, controlledSimulator.url);
  const sheet = await openSheet(page, "Christmas");
  await sheet.getByRole("switch", { name: "Turn on with this" }).click({ force: true });
  await expect(sheet.getByRole("status")).toHaveText("Zenit turns on with Christmas.");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("radio", { name: "Twinkle", exact: true }).check({ force: true });
  await expect(page.getByTestId("live-effect")).toHaveText("Twinkle");
  await controlledSimulator.control("!restart");
  await page.reload();
  await page.getByLabel("Address of your Zenit").fill(controlledSimulator.url);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByTestId("live-effect")).toHaveText("Christmas");
  await expect(tile(page, "Christmas")).toHaveAccessibleName("Christmas, on now, turns on with this");
});

test.describe("on a scripted board", () => {
  test("a board without favorites shows no card and is not asked", async ({ page }) => {
    const mock = await connectMock(page, new FakeBoard());
    await expect(page.getByRole("region", { name: "Effect", exact: true })).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByText("Favorites")).toHaveCount(0);
    expect(mock.commands()).not.toContain("favorites");
  });

  test("an error from the board is said in the bottom message and the list is read again", async ({ page }) => {
    const board = new FakeBoard().withFavorites();
    const mock = await connectMock(page, board);
    board.favorites = board.favorites!.filter((item) => item["id"] !== 1);
    await tile(page, "Starry night").click();
    await expect(message(page)).toHaveText("That favorite is no longer on Zenit.");
    await expect(message(page)).toHaveAttribute("role", "alert");
    await expect(tile(page, "Starry night")).toHaveCount(0);
    expect(mock.commands().slice(-2)).toEqual(["favorite_apply", "favorites"]);
  });

  test("an error of a request made in the sheet shows inside the sheet, not behind it", async ({ page }) => {
    const board = new FakeBoard().withFavorites();
    await connectMock(page, board);
    const sheet = await openSheet(page, "Christmas");
    // Another phone deleted it a moment ago
    board.favorites = board.favorites!.filter((item) => item["id"] !== 2);
    await sheet.getByRole("button", { name: "Use the light as it is now" }).click();
    // The sheet is gone with its favorite: the sentence is in the list under it, and nowhere else
    await expect(sheet).toBeHidden();
    await expect(dialog(page, "Edit favorites").getByRole("alert")).toHaveText("That favorite is no longer on Zenit.");
    await expect(message(page)).toHaveCount(0);
    // Back in the list
    await dialog(page, "Edit favorites").getByRole("button", { name: "Starry night" }).click();
    const other = dialog(page, "Starry night");
    board.errors.set("favorite_start", "storage_error");
    await other.getByRole("switch", { name: "Turn on with this" }).click({ force: true });
    await expect(other.getByRole("alert")).toHaveText("Zenit could not save that. Nothing was changed.");
    await expect(message(page)).toHaveCount(0);
    // The next request clears it
    board.errors.delete("favorite_start");
    await other.getByRole("button", { name: "Use the light as it is now" }).click();
    await expect(other.getByRole("alert")).toHaveCount(0);
    await expect(other.getByRole("status")).toHaveText("Updated Starry night.");
  });

  test("a refusal that comes after the save dialog was closed shows in the bottom message", async ({ page }) => {
    const board = new FakeBoard().withFavorites();
    board.errors.set("favorite_save", "storage_error");
    const mock = await connectMock(page, board);
    mock.delay = (request) => (request["cmd"] === "favorite_save" ? 600 : 0);
    await saveButton(page).click();
    const form = dialog(page, "Save this light");
    await form.getByLabel("Name").fill("Bedtime");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(form).toBeHidden();
    await expect(message(page)).toHaveText("Zenit could not save that. Nothing was changed.");
    await expect(message(page)).toHaveAttribute("role", "alert");
  });

  test("a late reply does not close a dialog opened after the one that asked", async ({ page }) => {
    const board = new FakeBoard().withFavorites();
    const mock = await connectMock(page, board);
    mock.delay = (request) => (request["cmd"] === "favorite_save" ? 600 : 0);
    await saveButton(page).click();
    const form = dialog(page, "Save this light");
    await form.getByLabel("Name").fill("Bedtime");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await form.getByRole("button", { name: "Cancel" }).click();
    await editButton(page).click();
    const list = dialog(page, "Edit favorites");
    await expect(list).toBeVisible();
    // The save works while the list is open: its confirmation is in the list, and the list stays
    await expect(list.getByRole("status")).toHaveText("Saved Bedtime.");
    await expect(list.getByRole("button", { name: "Bedtime" })).toBeVisible();
    await expect(list).toBeVisible();
    await expect(message(page)).toHaveCount(0);
  });

  test("a name the board refuses is shown next to the field", async ({ page }) => {
    const board = new FakeBoard().withFavorites();
    await connectMock(page, board);
    await saveButton(page).click();
    const form = dialog(page, "Save this light");
    // Another phone saved this name a moment ago
    board.favorites!.push({ id: 9, name: "Bedtime", effect: "static", brightness: 60, color: "white" });
    await form.getByLabel("Name").fill("Bedtime");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect(form.getByRole("alert")).toHaveText("You already have a favorite with that name.");
    await expect(message(page)).toHaveCount(0);
    await expect(tile(page, "Bedtime")).toBeVisible();
  });

  test("a favorite of an effect this app does not know shows its name and applies", async ({ page }) => {
    const board = new FakeBoard().withFavorites();
    board.favorites!.push({ id: 7, name: "Aurora", effect: "northern_lights", brightness: 50, color: "blue" });
    await connectMock(page, board);
    const aurora = tile(page, "Aurora");
    await expect(aurora).toBeVisible();
    expect(await aurora.getByTestId("favorite-preview").evaluate((node) => getComputedStyle(node).animationName)).toBe(
      "none",
    );
  });

  test("a lost connection greys the card and closes its dialogs", async ({ page }) => {
    const board = new FakeBoard().withFavorites();
    const mock = await connectMock(page, board);
    await editButton(page).click();
    await expect(dialog(page, "Edit favorites")).toBeVisible();
    mock.refuse = true;
    mock.drop();
    await expect(page.getByTestId("connection-lost")).toBeVisible({ timeout: 10_000 });
    await expect(dialog(page, "Edit favorites")).toBeHidden();
    await expect(tile(page, "Christmas")).toBeDisabled();
    await expect(saveButton(page)).toBeDisabled();
    await expect(editButton(page)).toBeDisabled();
  });
});
