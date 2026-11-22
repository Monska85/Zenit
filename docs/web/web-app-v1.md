# Web app, version 1

Status: **accepted**. Why it works this way is recorded in [ADR 0003](../adr/0003-web-app.md). The commands it sends are specified in the [command protocol](../protocol/protocol-v1.md), and the light it controls in [Light](../board/light-v1.md).

This document specifies the web app in `web/`: who uses it, the views, the connection, what each control sends, the wording, the errors, privacy, accessibility, publishing and the tests.

## Who and where

The user is a family member with no technical background, holding a phone or sitting at a laptop, who wants to turn the projector on, make it warmer or dimmer, pick an effect and set a sleep timer. Every screen must be obvious without reading a manual.

- **Browsers.** Chrome and Edge on desktop, and Chrome on Android, for USB (Web Serial). Any current browser for a WebSocket connection. A browser without Web Serial shows the USB option disabled, with the reason in one sentence.
- **Screens.** From 360 px wide to desktop, light and dark theme from the system, with a switch.
- **Language.** English. Localization is an open question for the owner.
- **Offline.** The app is a static site and needs no server of its own; once loaded it needs only the board.

## Views

A header with the name, a connection chip and a theme button; below it a navigation bar with **Light**, **Device** and **Privacy**. The connection chip says "Connected by USB" or "Connected over WiFi" (the address, for a WebSocket, is its tooltip and a row of the Device page). The address fragment holds the view (`#/light`, `#/device`, `#/privacy`, `#/connect`), so the back button works.

### Connect

Shown by **Light** while no board is connected. Two choices:

- **USB cable.** A button that opens the browser's port chooser, listing Espressif devices. Above it, in a warning box: "Unplug the panel power socket before you connect the USB cable. Never use both at the same time." Disabled, with a reason, when the browser has no Web Serial.
- **Address.** A text field and a Connect button for a Zenit or the simulator on WiFi (`zenit-1a2b.local`, `192.168.1.20`, `ws://127.0.0.1:8765`). The last address used is offered again. Described under [WebSocket](#websocket). On the published site (a page loaded over `https://` from another site than this computer) the field and its button are off, and a note above them says: "From this page a Zenit is reached with the USB cable. Over WiFi, open the Zenit's own address in the browser."

From the first click on either Connect button until the connection is open or has failed, both are off: the board has one connection slot, and a second attempt would take it. A failed or cancelled attempt changes nothing but the message: a connection that is already live stays as it is.

A link below leads to **Device**, to install the firmware on a new board.

The Connect screen hides every WiFi setup part: WiFi arrives with a later milestone, and the app shows only what the board reports.

### Light

The one screen a user lives in, top to bottom:

1. **Power.** One large round button, on or off, with the word "On" or "Off" under it. It sends `light` and is not saved, as in the protocol.
2. **Brightness.** A slider from 1 to 100 with its value. It sends `settings_set {brightness}` when released (or when a key press ends), never while moving.
3. **Effect.** One card per effect in `info.effects`, in the board's order, with a name and a one-line description. The selected card is marked. Choosing a card sends `settings_set {effect}`.
4. **Settings of the effect.** Below the cards, only what the selected effect reads (see the table below), each sent when chosen or released.
5. **Sleep timer.** Choices Off, 15 min, 30 min, 1 h, 2 h and Custom (1 to 360 minutes, a number field with a Set button). It sends `settings_set {timer_minutes}`. While a timer runs, the view shows the time left ("Fades out in 1 h 12 min"), taken from `status`; after it ended, "The timer ended. The light stays off until you turn it on."
6. **Right now.** A small panel with the color lit now (a swatch, or "Off"), the effect, and the power limit when it reduces the light ("Light reduced to 80 % to stay cool").

When the connection is USB, a note under the power button reads: "Connected by USB. The LED gets no power from USB: plug in the panel power socket and use WiFi to see the light." (the user must not have both).

| Effect         | Name in the app | One line                                   | Settings shown                                                      |
| -------------- | --------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| `static`       | Steady          | One color, always the same.                | Color                                                               |
| `color_change` | Color change    | Slowly moves through the colors you pick.  | Colors (2 to 4, in order), Time on each color, Dimmest level        |
| `breathing`    | Breathing       | Slowly brightens and dims.                 | Color, Length of a breath, Dimmest level                            |
| `twinkle`      | Twinkle         | A gentle shimmer, like a star.             | Color, Twinkle strength                                             |
| `fall_asleep`  | Fall asleep     | Dims slowly while the timer runs.          | Color, Dimmest level (and a hint to set the timer)                  |
| `christmas`    | Christmas       | Red, green and white, or icy blue.         | Palette, Time on each color, Dimmest level                          |

An effect the board lists and the app does not know gets a card with its identifier turned into words, no description and no settings. A color, color set or effect the app knows but the board does not list is not offered.

Setting controls:

| Setting            | Control                       | Label                 | Shown as                      | Limits (protocol)   |
| ------------------ | ----------------------------- | --------------------- | ----------------------------- | ------------------- |
| `color`            | swatch buttons, one choice    | Color                 | the color's name              | `info.colors`       |
| `colors`           | swatch buttons, ordered       | Colors                | 1, 2, 3 on the chosen ones    | 2 to 4, no repeats  |
| `color_set`        | two or more option buttons    | Palette               | Christmas, Ice                | `info.color_sets`   |
| `hold_seconds`     | slider                        | Time on each color    | `30 s`, `2 min`, `1 min 30 s` | 5 to 600            |
| `period_seconds`   | slider                        | Length of a breath    | `8 s`                         | 4 to 20             |
| `floor`            | slider                        | Dimmest level         | `20 %`                        | 5 to 80             |
| `twinkle_strength` | slider                        | Twinkle strength      | `20 %`                        | 5 to 50             |
| `timer_minutes`    | choices and a number field    | Sleep timer           | `Off`, `30 min`, `2 h`        | 0, or 1 to 360      |
| `brightness`       | slider                        | Brightness            | `60 %`                        | 1 to 100            |

The limits are constants in `web/src/light/model.ts`, equal to the protocol's. A reply whose setting is out of its limit is not a valid reply (see [Replies](#replies)).

### Device

Shows what the Zenit reports and the firmware tools:

- **Firmware.** The version the board runs, the latest published version, and one sentence: up to date, an update is available, or this board runs a newer or development build. The latest version comes from `firmware/manifest.json` on the site the app was loaded from; when it cannot be read (the app runs locally, or offline) the sentence says so and the install still works if the manifest exists.
- **Your Zenit.** The connection (the USB cable, or the address), `info.board` as "Hardware", the colors and effects listed, the power limit of the light in watts (`power_limit_mw`), and, under "Details for technicians", the protocol version, the colors and effects listed, the power limit of the light in watts (`power_limit_mw`), and memory and settings memory use for diagnosis.
- **Reset to defaults.** USB only. With a USB connection, a button that asks for confirmation ("Every setting goes back to its default.") and sends `settings_reset`. With a WebSocket connection the button is not shown and a sentence says it needs a USB cable. Not connected: not shown.
- **Install or update firmware.** See [Installing firmware](#installing-firmware).

Without a connection, Device shows the Firmware card (latest version and install) and a line "Connect to see your Zenit." With a lost connection it shows the last values of the Zenit.

### Privacy

States, in plain sentences, what the app does with data (see [Privacy rules](#privacy-rules)), and links the license, the third-party notices and the source.

## Connection

One connection at a time. Both transports carry the [command protocol](../protocol/protocol-v1.md) and share the client below.

### Client rules

The client follows the rules of `tools/zenit.py`, so the two stay equal:

- A request is `@ZN <crc> <json>`, CRC-32 over the JSON bytes as sent, eight lowercase hexadecimal digits. The JSON has `seq` first, then `cmd`, then the command's fields.
- `seq` starts at a random number below 2^31 for each connection and grows by one, so a new connection never looks like a retry of the last.
- **`info` first.** The client sends `info` and waits for its reply before any other request, and refuses a board whose `protocol` is not 1.
- **One request in flight.** Requests wait their turn. The client waits 2 seconds for the reply and sends the same line again, up to 5 times in all. A reply with the `bad_frame` error and no `seq` makes it send the line again at once.
- **Lines it throws away:** a line not starting with `@ZN `, a malformed or wrong CRC, JSON that breaks the strict rules, an event (no `seq`, an `event` field), a reply whose `seq` is not the request's (the same JSON number type: `1.0` is not `1`), and a reply that is not valid (see [Replies](#replies)).
- A request that gets no valid reply after 5 tries fails with "Zenit did not answer"; the connection is then treated as lost.

### Strict reply JSON

Replies are read by a reader of the app's own (`web/src/protocol/strict-json.ts`), because the browser's `JSON.parse` accepts what the protocol forbids and hides what the client must see. It rejects: invalid UTF-8, a newline or carriage return anywhere, comments, single quotes, unquoted keys, a trailing comma, anything after the object, control characters in strings, an unpaired escaped surrogate, U+0000, `NaN` and `Infinity`, a number that is not finite (`1e999`), and a key named twice in one object at any level (compared after decoding escapes). A number written with a fraction or an exponent is a *float*, one without is an *integer*; integer fields accept integers only. Nesting beyond 64 levels is refused.

### Replies

A reply with `ok: true` must have the known fields of its command with their types (unknown fields are ignored); one with `ok: false` must have a text `error` and `message`. The table is in `web/src/protocol/schema.ts` and equals `REPLIES` in `tools/zenit.py`: `info`, `status`, `light`, `settings_get`, `settings_set` and `settings_reset`. The app also checks every known setting against its limit and every `color`, `effect` and `color_set` against what `info` lists before it shows them.

### USB serial

- `navigator.serial.requestPort` with the Espressif USB vendor filter (`0x303A`), then `open` at 115,200 baud with `bufferSize` 8,192.
- **The control lines are left alone.** The app never calls `setSignals`. On the ESP32-C3's USB serial port, setting DTR and RTS in an order that clears one first runs the chip's reset sequence and restarts the board. Opening the port leaves both lines at the defaults the browser sets, which does not restart it.
- Lines end at `\n`; the reader keeps no more than 8,192 bytes without a newline. The board's log lines (`zenit: ...`) arrive on the same port and are ignored.
- The port closing (the cable pulled) ends the connection.
- Only one program can hold the port: the app releases it before the firmware installer opens it. Closing cancels the reader, aborts the writer (a write that never ends is given up on after 500 ms) and closes the port, each step within a limit. If the port still cannot be closed, the install does not start, and the dialog says: "The USB port is still in use. Unplug the USB cable, plug it in again, then reload this page."
- A reconnection after a lost connection opens the port it had when that still opens, and asks again only when it does not.

### WebSocket

- The address field accepts a full `ws://` or `wss://` URL, which is used as typed, or a host name or address, which becomes `ws://<host>/ws` (a port may follow the host). Anything else is refused with a sentence.
- One WebSocket message is one line, in both directions. A message that is not text, or longer than 4,096 bytes, is thrown away.
- The connection must open within 5 seconds.
- **Mixed content.** A browser does not let an `https://` page open an unencrypted `ws://` connection, except to the same computer (`localhost`, `127.0.0.1`). From the published site, then, a Zenit on the home network cannot be reached by an address, and the Connect screen says so before anything is typed (see [Connect](#connect)). A `ws://` address to another computer typed on an `https://` page that is on this computer is refused with: "Your browser does not let this page reach a Zenit over WiFi. Connect with the USB cable, or open the Zenit's own address in the browser." The WiFi milestone has the Zenit serve this app itself over HTTP, at `http://zenit-XXXX.local/`, and the app then connects over WiFi when the board serves it; this milestone does not implement that.
- The simulator's bridge (`just serve`) accepts the origins `http://localhost:*` and `http://127.0.0.1:*`, so the development server and the end-to-end tests connect to it.

### State and polling

The app keeps the board's `info`, `settings` (from `settings_get` on connect, then from every `settings_set` reply) and `light` (from `status`, `light`). While the page is visible, it asks `status` once per second, and never while another request is in flight. Polling stops while the page is hidden and starts with one `status` when it is shown again.

A setting is sent when the user chooses it. A choice is shown at once and replaced by what the board answers. While a slider moves, the app shows the value being chosen and sends nothing; it sends when the pointer is released. A slider moved with the keyboard sends 500 ms after the last key press, or at once when the focus leaves the slider or the view closes, so a run of key presses is one save. If the board answers an error, the app shows it, asks `settings_get` and shows what the board holds.

When the connection is lost (the cable pulled, the socket closed, five tries with no reply), the app shows "Connection lost" in the header with a Reconnect button, and keeps the Light view on screen with the last shown values, greyed and disabled, and a message above them. Reconnect opens the same connection again: the same address, or the same USB port when it still opens (otherwise the browser's chooser). Until it succeeds the last values stay; if it fails, the message says why and the view stays as it was.

## Installing firmware

The install uses [ESP Web Tools](https://esphome.github.io/esp-web-tools/), loaded only when the Device view opens.

1. The user presses **Install or update firmware**. A dialog first says, in a warning style: "Unplug the panel power socket from the wall before you connect the USB cable. Never connect USB and the panel power together." and asks to confirm with a checkbox "The panel power socket is unplugged".
2. After confirmation, if the app is connected over USB it closes that connection (the installer needs the port), then shows ESP Web Tools' own install button for `firmware/manifest.json` of the same site.
3. The installer writes the parts of the release at their own offsets: the bootloader at 0x0, the partition table at 0x8000, boot_app0 (the initial OTA data) at 0xE000 and the firmware at 0x10000 (the first slot of `partitions.csv`). None of them reaches the settings memory (NVS, 0x9000 to 0xDFFF), so an update **keeps the settings**. The manifest sets `new_install_prompt_erase`, so ESP Web Tools also offers to erase everything for a clean install; the dialog says that the settings are kept unless the user chooses that. Flashing the factory image at address 0 by hand (`zenit-esp32c3-factory.bin`, for a blank board) erases them.
4. When it ends, the user connects again from the Connect screen.

`firmware/manifest.json` is an ESP Web Tools manifest made by the release workflow:

```json
{
  "name": "Zenit",
  "version": "1.0.0",
  "new_install_prompt_erase": true,
  "builds": [
    {
      "chipFamily": "ESP32-C3",
      "parts": [
        { "path": "zenit-esp32c3-bootloader.bin", "offset": 0 },
        { "path": "zenit-esp32c3-partitions.bin", "offset": 32768 },
        { "path": "zenit-esp32c3-boot_app0.bin", "offset": 57344 },
        { "path": "zenit-esp32c3-firmware.bin", "offset": 65536 }
      ]
    }
  ]
}
```

The four files are published with the firmware release (`tools/release_assets.py` writes them next to the factory image, with their checksums) and copied beside the manifest by `tools/pages_site.py`, which checks each against the release's `SHA256SUMS`. The app reads `version` for the Device view and accepts a manifest only when `name` is `Zenit`, `version` is a semantic version, and `builds` has an `ESP32-C3` build.

### Version comparison

`info.firmware` is `X.Y.Z` for a release or `<tag>-dev.<n>+g<commit>[.dirty]` for another build ([Firmware version](../protocol/protocol-v1.md#firmware-version)). The app compares them by semantic version precedence (build metadata ignored): a board with a lower version than the published one "can be updated"; equal "is up to date"; higher, or a development build of a higher tag, "runs a newer build than the published one". A development build of the published tag (`1.0.0-dev.3`) is lower than the release, so it is offered the update.

## Errors

The app turns an error code into a sentence for people and never shows the board's `message` in place of it (the message is for logs). Unknown codes show "Zenit refused the request (<code>)."

| Code               | Sentence                                                                                |
| ------------------ | --------------------------------------------------------------------------------------- |
| `bad_request`      | Zenit did not accept that value.                                                        |
| `unknown_command`  | This Zenit firmware is too old for that. Update the firmware on the Device page.        |
| `storage_error`    | Zenit could not save that. Nothing was changed.                                         |
| `usb_only`         | This works only with a USB cable.                                                       |
| `busy`             | Zenit is busy. Try again in a moment.                                                   |
| no valid reply     | Zenit did not answer. Check the cable or the address.                                   |

Errors appear in a banner at the top of the view with a Close button (`role="alert"`), and clear on the next successful request.

## Privacy rules

- The app sends nothing to any outside server: no analytics, no fonts, no scripts, no images, no requests but the files of its own site (including `firmware/manifest.json`) and the board the user connects to. The privacy page says so, and the content security policy of the page enforces it: `default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'`.
- Settings, the board's details and the address of the board stay in the browser and travel only to the board.
- The browser's local storage holds two values: the theme choice and the last board address. Nothing else is stored.
- Installing firmware downloads the firmware file from the same site and writes it to the board over USB.

## Accessibility

- Every control has an accessible name; sliders have labels and announce their value as text (`60 %`); the power button is a toggle button with `aria-pressed`.
- Every control works with the keyboard; the focus is always visible.
- State is never carried by color alone: the selected effect has a mark and a text state; colors have names.
- Touch targets are at least 44 px high (a link inside a sentence is as high as its line, and a slider's target is its whole track). Text contrast meets WCAG AA in both themes.
- Banners use `role="alert"` for errors and `role="status"` for the timer line and the live state.
- `prefers-reduced-motion` turns the transitions off.

## Wording

Plain, short and warm. "Zenit" for the projector, "light" for what it shines, "device" only in the name of the Device page, and "board" only on that page. No jargon on the Light view: no protocol, firmware, serial or PWM. Sentences end with a period, buttons are verbs ("Connect", "Turn on"), and the user is addressed as "you".

## Publishing

- **Site.** One GitHub Pages site holds the latest web app at its root and the latest firmware under `firmware/` (the ESP Web Tools manifest and the firmware parts it writes). The app uses relative URLs, so the site works at `/<repository>/` or anywhere else.
- **Releases.** The web app is released by release-please as the package `web`, tags `web-vX.Y.Z`, separately from the firmware (`vX.Y.Z`). A web release attaches `zenit-web-X.Y.Z.tar.gz`; the Pages job assembles the site from the latest of each, whichever released last, and deploys it when the repository is public.
- **Notices.** The build writes `THIRD_PARTY_NOTICES.txt` at the root of the app, listing every bundled package with its license and the license texts, and fails when a bundled package has a license GPL-3.0-or-later cannot include or no license text. The app's `LICENSE.txt` and `LICENSE-EXCEPTION.txt` are written next to it.
- **Version.** The Privacy page shows the app version (from `web/package.json`) and links the source of the repository the build runs for.

## Tests

- **Unit (Vitest, Node):** CRC-32, the strict reader, framing, reply validation, the client with a scripted link (retries, immediate resend on `bad_frame`, one in flight, malformed replies), the protocol conformance cases (every framing case and every command case, with the client's framing and parsing), the Web Serial transport with a fake port (open options, no `setSignals`, line splitting, close), the WebSocket transport with a fake socket, the settings model and limits, the version comparison, the manifest reader, the address rules, the time formats.
- **End to end (Playwright, Chromium):** the built app served from a folder with a fixture `firmware/manifest.json`, against `tools/ws_bridge.py` and the simulator (`just sim-build` first): connect, power, brightness on release, every effect with its settings, timer, status, errors, the lost connection and its reconnection, the Device view, the privacy page, the theme, the keyboard, no outside request, a USB connection through a fake Web Serial port wired to the simulator.
- **Layout checks** at 360 px and at desktop width in both themes: no sideways scroll, nothing outside its box, touch targets, accessible names.
- **Reference screenshots,** one per main state and view at both widths and both themes, drawn inside the Playwright container so text renders the same everywhere.
- **Size budget:** the JavaScript loaded at start stays under 150 KB gzip; ESP Web Tools loads on demand and does not count.

## Limits

| Limit                                  | Value                |
| -------------------------------------- | -------------------- |
| Reply timeout, tries                   | 2 s, 5               |
| Status poll                            | 1 s                  |
| Reply line accepted                    | 4,096 bytes          |
| Serial read buffer                     | 8,192 bytes          |
| Serial baud rate                       | 115,200              |
| WebSocket connect time                 | 5 s                  |
| Initial JavaScript                     | 150 KB gzip          |
