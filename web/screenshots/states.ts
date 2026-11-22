// SPDX-License-Identifier: GPL-3.0-or-later

// The states of the app that the layout checks and the reference screenshots cover, scripted once. A state is reached
// with a scripted board (e2e/mock-board.ts), so every text and number is the same on every run. To add a state, add an
// entry here: both suites pick it up, and `just web-screenshots-update` draws its images.

import { expect, test, type Page } from "@playwright/test";
import { installFakeSerial } from "../e2e/fake-serial.ts";
import { MOCK_URL, mockBoard, type Mock } from "../e2e/mock-board.ts";
import { FakeBoard } from "../test/helpers.ts";

export interface State {
  name: string;
  /** Also drawn in the dark theme in the reference images (the layout checks always cover both). */
  dark?: boolean;
  /** Reaches the state from a blank page and waits until it shows. */
  reach: (page: Page) => Promise<void>;
  /** What the screenshot hides: text that changes by the second. */
  mask?: (page: Page) => import("@playwright/test").Locator[];
}

/** A board that reports the firmware of an older release and a timer, for the states that show them. */
function board(patch: (board: FakeBoard) => void = () => undefined): FakeBoard {
  const fake = new FakeBoard();
  fake.info["firmware"] = "0.9.0";
  patch(fake);
  return fake;
}

async function connectedLight(page: Page, fake: FakeBoard = board()): Promise<Mock> {
  const mock = await mockBoard(page, fake);
  await page.goto("/");
  await page.getByLabel("Address of your Zenit").fill(MOCK_URL);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByTestId("connection")).toBeVisible();
  await expect(page.getByTestId("live-effect")).toBeVisible();
  return mock;
}

const timerLine = (page: Page) => [page.getByTestId("timer-line")];

export const STATES: State[] = [
  {
    name: "connect",
    dark: true,
    reach: async (page) => {
      await installFakeSerial(page, MOCK_URL);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toBeVisible();
    },
  },
  {
    name: "connect-error",
    reach: async (page) => {
      await installFakeSerial(page, MOCK_URL);
      await page.goto("/");
      await page.getByLabel("Address of your Zenit").fill("not an address");
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(page.getByRole("alert")).toBeVisible();
    },
  },
  {
    // The published site: a page loaded over https, where an address cannot reach a Zenit
    name: "connect-secure-site",
    reach: async (page) => {
      const base = test.info().project.use.baseURL;
      await installFakeSerial(page, MOCK_URL);
      await page.route("https://zenit-site.test/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        await route.fulfill({ response: await route.fetch({ url: `${base}${path}` }) });
      });
      await page.goto("https://zenit-site.test/");
      await expect(page.getByText("From this page a Zenit is reached with the USB cable.")).toBeVisible();
    },
  },
  {
    name: "light",
    dark: true,
    reach: async (page) => void (await connectedLight(page)),
  },
  {
    name: "light-off",
    reach: async (page) =>
      void (await connectedLight(
        page,
        board((fake) => (fake.on = false)),
      )),
  },
  {
    name: "light-color-change",
    dark: true,
    reach: async (page) => {
      await connectedLight(
        page,
        board((fake) => {
          fake.settings["effect"] = "color_change";
          fake.settings["colors"] = ["red", "green", "white"];
        }),
      );
      await expect(page.getByRole("radio", { name: "Color change" })).toBeChecked();
    },
  },
  {
    name: "light-breathing",
    reach: async (page) => {
      await connectedLight(
        page,
        board((fake) => (fake.settings["effect"] = "breathing")),
      );
      await expect(page.getByRole("radio", { name: "Breathing" })).toBeChecked();
    },
  },
  {
    name: "light-christmas-timer",
    reach: async (page) => {
      await connectedLight(
        page,
        board((fake) => {
          fake.settings["effect"] = "christmas";
          fake.settings["timer_minutes"] = 45;
        }),
      );
      await page.getByRole("radio", { name: "Custom" }).check({ force: true });
      await expect(page.getByLabel("Minutes (1 to 360)")).toBeVisible();
    },
    mask: timerLine,
  },
  {
    name: "light-usb",
    reach: async (page) => {
      await mockBoard(page, board());
      await installFakeSerial(page, MOCK_URL);
      await page.goto("/");
      await page.getByRole("button", { name: "Connect with USB" }).click();
      await expect(page.getByTestId("connection")).toHaveText("Connected by USB");
    },
  },
  {
    name: "connection-lost",
    dark: true,
    reach: async (page) => {
      const mock = await connectedLight(page);
      mock.drop();
      await expect(page.getByText("Connection lost", { exact: true })).toBeVisible({ timeout: 10_000 });
    },
  },
  {
    name: "device",
    reach: async (page) => {
      await connectedLight(page);
      await page.getByRole("link", { name: "Device" }).click();
      await expect(page.getByTestId("firmware-state")).toHaveText("An update is available.");
    },
  },
  {
    name: "device-disconnected",
    reach: async (page) => {
      await page.goto("/#/device");
      await expect(page.getByTestId("firmware-published")).toHaveText("1.0.0");
    },
  },
  {
    name: "device-install-warning",
    dark: true,
    reach: async (page) => {
      await page.goto("/#/device");
      await expect(page.getByTestId("firmware-published")).toHaveText("1.0.0");
      await page.getByRole("button", { name: "Install or update firmware" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    },
  },
  {
    name: "device-reset",
    reach: async (page) => {
      await mockBoard(page, board());
      await installFakeSerial(page, MOCK_URL);
      await page.goto("/");
      await page.getByRole("button", { name: "Connect with USB" }).click();
      await expect(page.getByTestId("connection")).toBeVisible();
      await page.getByRole("link", { name: "Device" }).click();
      await page.getByRole("button", { name: "Reset to defaults" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    },
  },
  {
    name: "privacy",
    reach: async (page) => {
      await page.goto("/#/privacy");
      await expect(page.getByRole("heading", { name: "Privacy", level: 1 })).toBeVisible();
    },
  },
];

export const WIDTHS = [
  { name: "phone", width: 360, height: 740 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

export const THEMES = ["light", "dark"] as const;
