// SPDX-License-Identifier: GPL-3.0-or-later

// The states of the app that the layout checks and the reference screenshots cover, scripted once. A state is reached
// with a scripted board (e2e/mock-board.ts), so every text and number is the same on every run. To add a state, add an
// entry here: both suites pick it up, and `just web-screenshots-update` draws its images.

import { expect, test, type Page } from "@playwright/test";
import { installFakeSerial, scriptImprov } from "../e2e/fake-serial.ts";
import { packet, rpcCommandOf } from "../e2e/improv-frames.ts";
import { MOCK_URL, MOCK_USB_URL, mockBoard, type Mock } from "../e2e/mock-board.ts";
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
  await expect(page.getByRole("button", { name: /^Connection: (WiFi|USB)/ })).toBeVisible();
  await expect(page.getByTestId("live-state")).toBeVisible();
  return mock;
}

/** The time left, on the timer card and in the live line of the first card. */
const timerLine = (page: Page) => [
  page.getByTestId("timer-line"),
  page.getByTestId("live-state").getByText(/^fades out in/),
];

// The privacy view shows the web app version, a Semantic Versioning 2.0.0 version
const SCREENSHOT_VERSION_LABEL = "Version X.Y.Z";
const SEMVER_VERSION =
  /^Version (?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** A board from the WiFi and updates milestone, running an older release than the one it found. */
function networkBoard(patch: (board: FakeBoard) => void = () => undefined): FakeBoard {
  return board((fake) => {
    fake.withNetwork();
    fake.update = { ...fake.update, last_check: 1_800_000_000, last_result: "available", available: "1.0.0" };
    patch(fake);
  });
}

/** Opens the Device view of `fake` over WiFi. */
async function deviceOverWifi(page: Page, fake: FakeBoard): Promise<Mock> {
  const mock = await mockBoard(page, fake);
  await page.goto("/");
  await page.getByLabel("Address of your Zenit").fill(MOCK_URL);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("link", { name: "Device" }).click();
  await expect(page.getByRole("heading", { name: "Firmware updates" })).toBeVisible();
  return mock;
}

/** Opens the Device view of `fake` over USB, with an Improv board that sees one network. */
async function deviceOverUsb(page: Page, fake: FakeBoard): Promise<Mock> {
  const mock = await mockBoard(page, fake);
  await scriptImprov(page, (frame) =>
    rpcCommandOf(frame) === 4 ? [packet("one scanned network"), packet("the end of a scan")] : [],
  );
  await installFakeSerial(page, MOCK_USB_URL);
  await page.goto("/");
  await page.getByRole("button", { name: "Connect with USB" }).click();
  await expect(page.getByTestId("connection")).toContainText("USB");
  await page.getByRole("link", { name: "Device" }).click();
  await expect(page.getByTestId("wifi-setup")).toBeVisible();
  return mock;
}

/** A page served by a board: its own origin answers /board.json and the board's WebSocket. */
async function served(page: Page, fake: FakeBoard): Promise<Mock> {
  const base = new URL(test.info().project.use.baseURL as string);
  await page.route("**/board.json", (route) =>
    route.fulfill({ contentType: "application/json", body: '{"zenit":true,"hostname":"zenit-a1b2","ws":"/ws"}' }),
  );
  return mockBoard(page, fake, [`ws://${base.host}/ws`]);
}

export const STATES: State[] = [
  {
    name: "connect",
    dark: true,
    reach: async (page) => {
      await installFakeSerial(page, MOCK_USB_URL);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Connect to your Zenit" })).toBeVisible();
    },
  },
  {
    // The last board that worked, one tap away
    name: "connect-last-board",
    dark: true,
    reach: async (page) => {
      await installFakeSerial(page, MOCK_USB_URL);
      await page.addInitScript(() => localStorage.setItem("zenit.address", "zenit-1a2b.local"));
      await page.goto("/");
      await expect(page.getByTestId("last-board")).toBeVisible();
    },
  },
  {
    // A browser with no Web Serial, as on most phones: the address first, the USB choice folded
    name: "connect-no-usb",
    reach: async (page) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "serial", { configurable: true, value: undefined });
      });
      await page.goto("/");
      await expect(page.getByTestId("usb-folded")).toBeVisible();
    },
  },
  {
    name: "connect-error",
    reach: async (page) => {
      await installFakeSerial(page, MOCK_USB_URL);
      await page.goto("/");
      await page.getByLabel("Address of your Zenit").fill("not an address");
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(page.getByRole("alert")).toBeVisible();
    },
  },
  {
    // The published site: a page loaded over https, where Chrome asks before the page reaches the local network
    name: "connect-secure-site",
    reach: async (page) => {
      const base = test.info().project.use.baseURL;
      await installFakeSerial(page, MOCK_USB_URL);
      await page.route("https://zenit-site.test/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        await route.fulfill({ response: await route.fetch({ url: `${base}${path}` }) });
      });
      await page.goto("https://zenit-site.test/");
      await expect(page.getByText("The first time, Chrome asks to let this page find devices")).toBeVisible();
    },
  },
  {
    name: "light",
    dark: true,
    reach: async (page) => void (await connectedLight(page)),
  },
  {
    // The header menu open: how Zenit is connected, the theme and Disconnect
    name: "light-menu",
    dark: true,
    reach: async (page) => {
      await connectedLight(page, networkBoard());
      await page.getByRole("button", { name: /^Connection:/ }).click();
      await expect(page.getByRole("group", { name: "Theme" })).toBeVisible();
    },
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
    // An effect this app does not know, selected: its card and the line in place of its settings
    name: "light-newer-effect",
    reach: async (page) => {
      await connectedLight(
        page,
        board((fake) => {
          fake.info["effects"] = [...(fake.info["effects"] as string[]), "northern_lights"];
          fake.settings["effect"] = "northern_lights";
        }),
      );
      await expect(page.getByTestId("newer-effect")).toBeVisible();
    },
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
      // A custom value shows on its chip
      await expect(page.getByRole("radio", { name: "Custom · 45 min" })).toBeChecked();
      await expect(page.getByLabel("Minutes (1 to 360)")).toBeVisible();
    },
    mask: timerLine,
  },
  {
    name: "light-usb",
    reach: async (page) => {
      await mockBoard(page, board());
      await installFakeSerial(page, MOCK_USB_URL);
      await page.goto("/");
      await page.getByRole("button", { name: "Connect with USB" }).click();
      await expect(page.getByTestId("connection")).toContainText("USB");
    },
  },
  {
    name: "connection-lost",
    dark: true,
    reach: async (page) => {
      const mock = await connectedLight(page);
      mock.drop();
      await expect(page.getByTestId("connection-lost")).toBeVisible({ timeout: 10_000 });
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
      await installFakeSerial(page, MOCK_USB_URL);
      await page.goto("/");
      await page.getByRole("button", { name: "Connect with USB" }).click();
      await expect(page.getByRole("button", { name: /^Connection: (WiFi|USB)/ })).toBeVisible();
      await page.getByRole("link", { name: "Device" }).click();
      await page.getByRole("button", { name: "Reset to defaults" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    },
  },
  {
    name: "device-wifi-setup",
    reach: async (page) => {
      await deviceOverUsb(page, networkBoard());
      await page.getByRole("button", { name: "Scan for networks" }).click();
      await page.getByRole("button", { name: /HomeNet/ }).click();
      await expect(page.getByLabel("Network name")).toHaveValue("HomeNet");
    },
  },
  {
    name: "device-access-usb",
    dark: true,
    reach: async (page) => {
      await deviceOverUsb(
        page,
        networkBoard((fake) => (fake.settings["network_login"] = true)),
      );
      await expect(page.getByTestId("token")).toBeVisible();
    },
  },
  {
    name: "device-updates",
    dark: true,
    reach: async (page) => {
      await deviceOverWifi(page, networkBoard());
      await expect(page.getByTestId("update-result")).toHaveText("Version 1.0.0 is available.");
    },
  },
  {
    name: "device-update-downloading",
    reach: async (page) => {
      await deviceOverWifi(
        page,
        networkBoard((fake) => {
          fake.update = { ...fake.update, state: "downloading", progress: 40 };
        }),
      );
      await expect(page.getByRole("progressbar", { name: "Download progress" })).toHaveAttribute("aria-valuenow", "40");
    },
  },
  {
    name: "device-update-skipped",
    reach: async (page) => {
      await deviceOverWifi(
        page,
        networkBoard((fake) => {
          fake.update = {
            ...fake.update,
            last_result: "skipped",
            skipped: "1.0.0",
            rolled_back: "1.0.0",
            trial: false,
          };
        }),
      );
      await expect(page.getByRole("button", { name: "Install 1.0.0 anyway" })).toBeVisible();
    },
  },
  {
    name: "device-install-confirm",
    dark: true,
    reach: async (page) => {
      await deviceOverWifi(page, networkBoard());
      await page.getByRole("button", { name: "Install 1.0.0" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    },
  },
  {
    name: "device-not-published",
    reach: async (page) => {
      await deviceOverWifi(
        page,
        networkBoard((fake) => {
          fake.update = { ...fake.update, available: null, last_result: "not_published" };
        }),
      );
      await expect(page.getByTestId("update-result")).toContainText("no firmware published yet");
    },
  },
  {
    name: "login",
    dark: true,
    reach: async (page) => {
      await mockBoard(
        page,
        networkBoard((fake) => (fake.settings["network_login"] = true)),
      );
      await page.goto("/");
      await page.getByLabel("Address of your Zenit").fill(MOCK_URL);
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Log in to your Zenit" })).toBeVisible();
    },
  },
  {
    name: "restarting",
    reach: async (page) => {
      const mock = await deviceOverWifi(
        page,
        networkBoard((fake) => {
          fake.update = { ...fake.update, state: "restarting" };
        }),
      );
      mock.refuse = true;
      mock.drop();
      await expect(page.getByTestId("auto-reconnect")).toHaveText(
        "Zenit is restarting. It connects again by itself in a few seconds.",
      );
    },
  },
  {
    // The app served by a board: the header names the board, there is no installer and no USB option
    name: "served-light",
    reach: async (page) => {
      await served(page, networkBoard());
      await page.goto("/");
      await expect(page.getByTestId("hostname")).toHaveText("zenit-a1b2");
      await expect(page.getByTestId("live-effect")).toBeVisible();
    },
  },
  {
    name: "served-device",
    reach: async (page) => {
      await served(page, networkBoard());
      await page.goto("/#/device");
      await expect(page.getByTestId("install-served-note")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Firmware updates" })).toBeVisible();
    },
  },
  {
    name: "privacy",
    reach: async (page) => {
      await page.goto("/#/privacy");
      await expect(page.getByRole("heading", { name: "Privacy", level: 1 })).toBeVisible();
      // Release pull requests change the real version: check its form, then draw a neutral label
      const version = page.getByTestId("app-version");
      await expect(version).toHaveText(SEMVER_VERSION);
      await version.evaluate((element, label) => {
        element.textContent = label;
      }, SCREENSHOT_VERSION_LABEL);
    },
  },
];

export const WIDTHS = [
  { name: "phone", width: 360, height: 740 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

export const THEMES = ["light", "dark"] as const;
