// SPDX-License-Identifier: GPL-3.0-or-later

// The states of the app that the layout checks and the reference screenshots cover, scripted once. A state is reached
// with a scripted board (e2e/mock-board.ts), so every text and number is the same on every run. To add a state, add an
// entry here: both suites pick it up, and `just web-screenshots-update` draws its images.

import { expect, test, type Page } from "@playwright/test";
import { installFakeSerial, scriptImprov } from "../e2e/fake-serial.ts";
import { packet, rpcCommandOf } from "../e2e/improv-frames.ts";
import { MOCK_URL, MOCK_USB_URL, mockBoard, type Mock } from "../e2e/mock-board.ts";
import { FakeBoard } from "../test/helpers.ts";
import { textsOf } from "../e2e/catalog.ts";

export interface State {
  name: string;
  /** Also drawn in the dark theme in the reference images (the layout checks always cover both). */
  dark?: boolean;
  /** Reaches the state from a blank page and waits until it shows. */
  reach: (page: Page) => Promise<void>;
  /** The browser's time zone, UTC (the simulator's) unless a state needs another. */
  timezoneId?: string;
  /** The browser's language, English (en-GB) unless the state shows the app in another language. */
  locale?: string;
  /** Drawn in the reference images at the phone width only (the layout checks always cover both widths). */
  phoneOnly?: boolean;
  /** What the screenshot hides: text that changes by the second. */
  mask?: (page: Page) => import("@playwright/test").Locator[];
}

/** A board that reports the firmware of an older release and a timer, for the states that show them. It has the two
 * ready-made favorites, as a new board of the firmware with favorites does. */
function board(patch: (board: FakeBoard) => void = () => undefined): FakeBoard {
  const fake = new FakeBoard().withFavorites();
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
  await expect(page.getByTestId("update-result")).toBeVisible();
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

/** Six favorites, as the design shows them: a long name, one the light shows now (Reading), one Zenit turns on with. */
const SIX_FAVORITES = [
  { id: 1, name: "Starry night", effect: "shooting_star", brightness: 60, color: "white" },
  { id: 2, name: "Christmas", effect: "christmas", brightness: 60, color_set: "christmas", hold_seconds: 30 },
  {
    id: 3,
    name: "Grandma's night glow",
    effect: "breathing",
    brightness: 30,
    color: "red",
    period_seconds: 8,
    floor: 20,
  },
  { id: 4, name: "Reading", effect: "static", brightness: 80, color: "white" },
  { id: 5, name: "Bath time", effect: "color_change", brightness: 50, colors: ["blue", "green"], hold_seconds: 30 },
  { id: 6, name: "Party", effect: "hop", brightness: 70, color_set: "all" },
];

/** A board with six favorites, the light showing Reading and Zenit turning on with Starry night. */
const sixFavorites = (fake: FakeBoard): void => {
  fake.favorites = structuredClone(SIX_FAVORITES);
  fake.start = 1;
  fake.settings["effect"] = "static";
  fake.settings["brightness"] = 80;
  fake.settings["color"] = "white";
};

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
    // The card of a board with no favorite: the hint and one button
    name: "favorites-none",
    dark: true,
    reach: async (page) => {
      await connectedLight(
        page,
        board((fake) => (fake.favorites = [])),
      );
      await expect(page.getByTestId("favorites-empty")).toBeVisible();
    },
  },
  {
    // The two ready-made favorites: the light shows Starry night, and Zenit turns on with Christmas
    name: "favorites-two",
    dark: true,
    reach: async (page) => {
      await connectedLight(
        page,
        board((fake) => {
          fake.settings["effect"] = "shooting_star";
          fake.start = 2;
        }),
      );
      await expect(page.getByRole("button", { name: "Starry night, on now" })).toBeVisible();
    },
  },
  {
    // Six favorites: a name that wraps, the one on now, the one Zenit turns on with
    name: "favorites-six",
    dark: true,
    reach: async (page) => {
      await connectedLight(page, board(sixFavorites));
      await expect(page.getByRole("button", { name: "Reading, on now" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Starry night, turns on with this" })).toBeVisible();
    },
  },
  {
    name: "favorites-save",
    dark: true,
    reach: async (page) => {
      await connectedLight(page);
      await page.getByRole("button", { name: "Save this light" }).click();
      await expect(page.getByRole("dialog", { name: "Save this light" })).toBeVisible();
    },
  },
  {
    // The save dialog with the name checked: the sentence under the field
    name: "favorites-save-problem",
    reach: async (page) => {
      await connectedLight(page);
      await page.getByRole("button", { name: "Save this light" }).click();
      const dialog = page.getByRole("dialog", { name: "Save this light" });
      await dialog.getByLabel("Name").fill("christmas");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(dialog.getByRole("alert")).toBeVisible();
    },
  },
  {
    name: "favorites-full",
    reach: async (page) => {
      await connectedLight(page, board(sixFavorites));
      await page.getByRole("button", { name: "Save this light" }).click();
      const dialog = page.getByRole("dialog", { name: "Your favorites are full" });
      await dialog.getByRole("radio", { name: "Bath time" }).check({ force: true });
      await expect(dialog.getByRole("button", { name: "Replace" })).toBeEnabled();
    },
  },
  {
    name: "favorites-edit",
    reach: async (page) => {
      await connectedLight(page, board(sixFavorites));
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Edit favorites" })).toBeVisible();
    },
  },
  {
    // A favorite's sheet, with Zenit turning on with another one
    name: "favorites-sheet",
    dark: true,
    reach: async (page) => {
      await connectedLight(page, board(sixFavorites));
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("dialog", { name: "Edit favorites" }).getByRole("button", { name: "Reading" }).click();
      await expect(page.getByRole("dialog", { name: "Reading", exact: true })).toBeVisible();
    },
  },
  {
    name: "favorites-delete",
    reach: async (page) => {
      await connectedLight(page, board(sixFavorites));
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("dialog", { name: "Edit favorites" }).getByRole("button", { name: "Party" }).click();
      await page.getByRole("dialog", { name: "Party", exact: true }).getByRole("button", { name: "Delete" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    },
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
    // The power button off, in both themes: it must look clearly unlike the lit one
    name: "light-off",
    dark: true,
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
      await expect(page.getByRole("radio", { name: "Breathing", exact: true })).toBeChecked();
    },
  },
  {
    name: "light-guided-breathing",
    reach: async (page) => {
      await connectedLight(
        page,
        board((fake) => {
          fake.settings["effect"] = "guided_breathing";
          fake.settings["breath_pattern"] = "box";
        }),
      );
      await expect(page.getByRole("radio", { name: /^Box/ })).toBeChecked();
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
    // The folded settings opened: update settings with the hour list and the install window, the time, the switches
    name: "device-advanced",
    dark: true,
    reach: async (page) => {
      await deviceOverWifi(page, networkBoard());
      await page.getByText("Advanced settings", { exact: true }).click();
      await expect(page.getByRole("region", { name: "Time", exact: true })).toBeVisible();
    },
  },
  {
    // A browser in another zone than the board's: the offer of its zone, first on the Device page
    name: "device-time-offer",
    dark: true,
    timezoneId: "Asia/Kolkata",
    reach: async (page) => {
      await deviceOverWifi(page, networkBoard());
      await expect(page.getByTestId("time-zone-offer")).toContainText("Zenit uses UTC time.");
    },
  },
  {
    // The search of the Time card with its suggestions open
    name: "device-time-search",
    dark: true,
    reach: async (page) => {
      await deviceOverWifi(page, networkBoard());
      await page.getByText("Advanced settings", { exact: true }).click();
      const search = page.getByRole("combobox", { name: "Find a time zone" });
      await search.fill("ind");
      await search.press("ArrowDown");
      await expect(page.getByRole("listbox", { name: "Time zones" }).getByRole("option")).toHaveCount(8);
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
      await expect(page.getByTestId("update-result")).toBeVisible();
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
  ...italianStates(),
];

/**
 * The main views in Italian, for a browser whose language is Italian, drawn at the phone width in both themes. Italian
 * is longer than English: the layout checks show that no text overflows or is cut at 360 px.
 */
function italianStates(): State[] {
  const it = textsOf("it");
  const connected = async (page: Page, fake: FakeBoard = networkBoard()): Promise<Mock> => {
    const mock = await mockBoard(page, fake);
    await page.goto("/");
    await page.getByLabel(it("connect:address.label")).fill(MOCK_URL);
    await page.getByRole("button", { name: it("connect:connect"), exact: true }).click();
    await expect(page.getByTestId("live-state")).toBeVisible();
    return mock;
  };
  const device = async (page: Page): Promise<void> => {
    await connected(page);
    await page.getByRole("link", { name: it("common:tabs.device") }).click();
    await expect(page.getByTestId("update-result")).toBeVisible();
  };
  const states: Array<Omit<State, "locale" | "phoneOnly" | "dark">> = [
    {
      name: "it-connect",
      reach: async (page) => {
        await page.goto("/");
        await expect(page.getByRole("heading", { name: it("connect:title") })).toBeVisible();
      },
    },
    {
      name: "it-light",
      reach: async (page) => void (await connected(page)),
      mask: timerLine,
    },
    {
      name: "it-menu",
      reach: async (page) => {
        await connected(page);
        await page.getByTestId("connection").click();
        await expect(page.getByRole("group", { name: it("common:language.legend") })).toBeVisible();
      },
      mask: timerLine,
    },
    {
      name: "it-favorites-sheet",
      reach: async (page) => {
        await connected(page);
        await page.getByRole("button", { name: it("favorites:card.edit"), exact: true }).click();
        await page
          .getByRole("dialog", { name: it("favorites:edit.title") })
          .getByRole("button", { name: "Starry night", exact: true })
          .click();
        await expect(page.getByRole("dialog", { name: "Starry night" })).toBeVisible();
      },
    },
    {
      name: "it-error",
      reach: async (page) => {
        const mock = await connected(page);
        mock.board.errors.set("settings_set", "bad_request");
        // The board refuses, so the choice goes back at once: a click in the page, not a check that waits for the change
        await page
          .getByRole("radio", { name: it("light:effects.twinkle.label"), exact: true })
          .evaluate((radio: HTMLInputElement) => radio.click());
        await expect(page.getByTestId("bottom-message")).toHaveText(it("errors:board.bad_request"));
      },
      mask: timerLine,
    },
    {
      name: "it-connection-lost",
      reach: async (page) => {
        const mock = await connected(page);
        mock.drop();
        await expect(page.getByTestId("connection-lost")).toBeVisible({ timeout: 10_000 });
      },
      mask: timerLine,
    },
    {
      name: "it-device",
      reach: device,
    },
    {
      name: "it-device-advanced",
      reach: async (page) => {
        await device(page);
        await page.getByText(it("device:advanced.title"), { exact: true }).click();
        await expect(page.getByRole("region", { name: it("device:time.title"), exact: true })).toBeVisible();
      },
    },
    {
      name: "it-privacy",
      reach: async (page) => {
        await page.goto("/#/privacy");
        await expect(page.getByRole("heading", { name: it("privacy:title"), level: 1 })).toBeVisible();
        await page.getByTestId("app-version").evaluate(
          (element, label) => {
            element.textContent = label;
          },
          it("privacy:about.version", { version: "X.Y.Z" }),
        );
      },
    },
  ];
  return states.map((state) => ({ ...state, locale: "it-IT", phoneOnly: true, dark: true }));
}

export const WIDTHS = [
  { name: "phone", width: 360, height: 740 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

export const THEMES = ["light", "dark"] as const;
