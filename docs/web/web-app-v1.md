# Web app, version 1

Status: **accepted**. Why it works this way is recorded in [ADR 0003](../adr/0003-web-app.md). The commands it sends are specified in the [command protocol](../protocol/protocol-v1.md), and the light it controls in [Light](../board/light-v1.md).

This document specifies the web app in `web/`: who uses it, the views, the connection, what each control sends, the WiFi setup, the login, firmware updates, the wording, the errors, privacy, accessibility, publishing and the tests. The board side of WiFi, the served app and updates is in [WiFi and updates](../board/wifi-and-updates-v1.md).

## Who and where

The user is a family member with no technical background, holding a phone or sitting at a laptop, who wants to turn the projector on, make it warmer or dimmer, pick an effect and set a sleep timer. Every screen must be obvious without reading a manual.

- **Browsers.** Chrome and Edge on desktop, and Chrome on Android, for USB (Web Serial), which also sets up the WiFi. Any current browser for a WebSocket connection, and so for the page a Zenit serves itself. A browser without Web Serial shows the USB option disabled, with the reason in one sentence.
- **Screens.** From 360 px wide to desktop, light and dark theme from the system, with a switch.
- **Language.** English. Localization is an open question for the owner.
- **Offline.** The app is a static site and needs no server of its own; once loaded it needs only the board. The board serves the same app on its own address, so a phone on the home network needs nothing from the internet.

## Views

A header with the name, a connection chip and a theme button; below it a navigation bar with **Light**, **Device** and **Privacy**. The connection chip says "Connected by USB" or "Connected over WiFi" (the address, for a WebSocket, is its tooltip and a row of the Device page). On a page served by a Zenit the chip also names the board (`zenit-a1b2`) and has no Disconnect button. While the Zenit waits for a token the chip says "Log in needed", and while a lost connection is being opened again by itself it says "The board is restarting" or "Connecting again...". The address fragment holds the view (`#/light`, `#/device`, `#/privacy`, `#/connect`), so the back button works.

### Connect

Shown by **Light** while no board is connected. Two choices:

- **USB cable.** A button that opens the browser's port chooser, listing Espressif devices. Above it, in a warning box: "Unplug the panel power socket before you connect the USB cable. Never use both at the same time." Disabled, with a reason, when the browser has no Web Serial.
- **Address.** A text field and a Connect button for a Zenit or the simulator on WiFi (`zenit-1a2b.local`, `192.168.1.20`, `ws://127.0.0.1:8765`). The last address used is offered again. Described under [WebSocket](#websocket). On the published site (a page loaded over `https://` from another site than this computer) the field and its button are off, and a note above them says: "From this page a Zenit is reached with the USB cable. Over WiFi, open the Zenit's own address in the browser."

From the first click on either Connect button until the connection is open or has failed, both are off: the board has one connection slot, and a second attempt would take it. A failed or cancelled attempt changes nothing but the message: a connection that is already live stays as it is.

A link below leads to **Device**, to install the firmware on a new board.

WiFi is not set up on this screen but in the WiFi card of **Device**, over USB (see [WiFi setup](#wifi-setup)).

**Served by a Zenit.** A page loaded over `http://` first asks its own origin for `/board.json` (see [Served by a board](#served-by-a-board)); until it knows, the screen says "Looking for your Zenit...". When a Zenit served the page, the screen is "Your Zenit" with the board's name, the sentence "This page comes from your Zenit, so it connects to it by itself." and a Connect button for a connection that did not open. There is no USB option and no address field there, and the sentence under them explains that installing firmware over a USB cable needs the project's own page on the internet.

**Log in.** A board that wants a token (see [Login](#login)) shows "Log in to your Zenit" in place of the Light and Device views: a field for the token, the sentence "This Zenit asks for a token before it lets you control it over WiFi. The token has 16 letters and digits. You find it in the Device page when Zenit is connected with the USB cable, or with the command line tool over USB.", and a Log in button.

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

Shows what the Zenit reports, its network and update settings, and the firmware tools, top to bottom (a card is left out when the board does not report what it shows, as a board from before the WiFi and updates milestone does not):

- **Your Zenit.** The connection, the hardware and the lists the board reports (below).
- **WiFi.** See [WiFi setup](#wifi-setup).
- **Firmware.** The version the board runs, the latest published version, and one sentence: up to date, an update is available, or this board runs a newer or development build. The latest version comes from `firmware/manifest.json` on the site the app was loaded from; when it cannot be read (the app runs locally, or offline) the sentence says so and the install still works if the manifest exists. On a page served by a Zenit there is no published version: the row and the sentence are left out.
- **Firmware updates.** What the board does about updates and the two actions on it. See [Firmware updates](#firmware-updates).
- **Update settings.** See [Board settings](#board-settings).
- **Time.** See [Board settings](#board-settings).
- **Access over WiFi.** The login switch and, over USB, the token. See [Login](#login).
- **Your Zenit.** The connection (the USB cable, or the address), `info.board` as "Hardware", the colors and effects listed, the power limit of the light in watts (`power_limit_mw`), and, under "Details for technicians", the protocol version, the colors and effects listed, the power limit of the light in watts (`power_limit_mw`), and memory and settings memory use for diagnosis.
- **Reset to defaults.** USB only. With a USB connection, a button that asks for confirmation ("Every setting goes back to its default.") and sends `settings_reset`. It also forgets the WiFi network and makes a new token, and the confirmation says so. With a WebSocket connection the button is not shown and a sentence says it needs a USB cable. Not connected: not shown.
- **Install or update firmware.** See [Installing firmware](#installing-firmware). Not shown on a page served by a Zenit: a sentence says that installing over a USB cable needs the project's page on the internet, and that updates over WiFi work from here.

Without a connection, Device shows the Firmware card (latest version and install) and a line "Connect to see your Zenit." With a lost connection it shows the last values of "Your Zenit" and the Firmware card; the cards that change something are left out until the connection is back.

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

A reply with `ok: true` must have the known fields of its command with their types (unknown fields are ignored); one with `ok: false` must have a text `error` and `message`. The table is in `web/src/protocol/schema.ts` and equals `REPLIES` in `tools/zenit.py`: `info`, `status`, `light`, `settings_get`, `settings_set`, `settings_reset`, `token_regenerate`, `auth_challenge`, `update_check` and `update_install`. The `wifi`, `time` and `update` parts of `status` and the board settings of the settings replies (the token included) are optional, so a board from before the WiFi and updates milestone is still valid; when present they have their types. The commands `wifi_forget` and `auth` have no reply fields to check. The app also checks every known setting, the board settings too, against its limit and every `color`, `effect` and `color_set` against what `info` lists before it shows them (`web/src/light/model.ts` and `web/src/device/settings.ts`). The WiFi, time and update parts and the board settings are checked against the specification's words, ranges and null-when rules too (a percentage only while downloading and from 0 to 100, an address and a signal only while connected, the time, its minute and `synced` together, a version offered after a check that found one, a token of 16 characters, a nonce of 32 hexadecimal digits), the same way in `tools/zenit.py`; a reply that breaks one is thrown away like any malformed reply. The words that name a state, a result or a choice (`wifi.state`, `update.mode`, `update.state`, `update.last_result`, `wifi_power`, `update_mode`) are open, as the [protocol's compatibility rule](../protocol/protocol-v1.md#protocol-version) says: any text passes, the app says a plain sentence for one it does not know, and a choice shows the board's own word as an extra option labelled "new in this Zenit".

### USB serial

- `navigator.serial.requestPort` with the Espressif USB vendor filter (`0x303A`), then `open` at 115,200 baud with `bufferSize` 8,192.
- **The control lines are left alone.** The app never calls `setSignals`. On the ESP32-C3's USB serial port, setting DTR and RTS in an order that clears one first runs the chip's reset sequence and restarts the board. Opening the port leaves both lines at the defaults the browser sets, which does not restart it.
- Lines end at `\n`; the reader keeps no more than 8,192 bytes without a newline. The board's log lines (`zenit: ...`) arrive on the same port and are ignored. [Improv frames](#improv-wi-fi-serial) arrive there too: the reader cuts them out of the stream before it looks for lines.
- The port closing (the cable pulled) ends the connection.
- Only one program can hold the port: the app releases it before the firmware installer opens it. Closing cancels the reader, aborts the writer (a write that never ends is given up on after 500 ms) and closes the port, each step within a limit. If the port still cannot be closed, the install does not start, and the dialog says: "The USB port is still in use. Unplug the USB cable, plug it in again, then reload this page."
- A reconnection after a lost connection opens the port it had when that still opens, and asks again only when it does not.

### WebSocket

- The address field accepts a full `ws://` or `wss://` URL, which is used as typed, or a host name or address, which becomes `ws://<host>/ws` (a port may follow the host). Anything else is refused with a sentence.
- One WebSocket message is one line, in both directions. A message that is not text, or longer than 4,096 bytes, is thrown away.
- The connection must open within 5 seconds.
- **Mixed content.** A browser does not let an `https://` page open an unencrypted `ws://` connection, except to the same computer (`localhost`, `127.0.0.1`). From the published site, then, a Zenit on the home network cannot be reached by an address, and the Connect screen says so before anything is typed (see [Connect](#connect)). A `ws://` address to another computer typed on an `https://` page that is on this computer is refused with: "Your browser does not let this page reach a Zenit over WiFi. Connect with the USB cable, or open the Zenit's own address in the browser." The Zenit serves this app itself over HTTP, at `http://zenit-XXXX.local/`, and the app then connects over WiFi when the board serves it (see [Served by a board](#served-by-a-board)).
- The simulator's bridge (`just serve`) accepts the origins `http://localhost:*` and `http://127.0.0.1:*`, so the development server and the end-to-end tests connect to it.

- **Login time.** A board closes a connection that has not logged in within 10 seconds of opening (a silent client must not hold its single connection), so the person has the token ready: the app keeps the token prompt and whatever was typed, and says "Zenit closed the idle connection after 10 seconds. Type the token and press Log in: this page connects again by itself." Nothing reconnects while the prompt sits idle; pressing Log in opens the connection again, asks `info`, then `auth_challenge` and `auth` with the token typed, and carries on (a token that is not right shows the usual message and keeps the prompt).
- **Close statuses.** A board closes a WiFi connection with status 1008 after three wrong tokens (or from an origin it does not accept) and with 1013 when another page holds it. The app turns them into sentences: "Zenit closed the connection: the access token was wrong three times, or this page is not allowed to connect." and "Another page or phone is already connected to this Zenit. Close it, then connect again." A board that closes a connection that never logged in (it waits 30 seconds) gets "Zenit closed the connection because no token was given in time. Connect again."

### Served by a board

A page loaded over `http:` (never over `https:`: a board has no HTTPS) asks its own origin for `GET /board.json` once at start, with no credentials, no cache and no redirect, and gives up after 2 seconds. It is served by a board only when the answer is exactly `{"zenit":true,"hostname":"zenit-xxxx","ws":"/ws"}`: strict JSON of at most 256 bytes, no other field, `zenit` true, `ws` exactly `/ws`, and a hostname of `zenit-` and four lowercase hexadecimal digits (the simulator's bridge reports `zenit-0000`). Anything else, a 404 included, means the page is not served by a board, and the Connect screen is the one of any other site. The only request is to the page's own origin.

When a board served the page the app connects to `ws://<location.host>/ws` by itself, shows the board's name in the header, and hides what cannot work there: the USB option and the firmware installer (Web Serial needs a secure page). The Light and Device views work as over any WebSocket. A connection that did not open leaves the "Your Zenit" screen with a Connect button.

### Login

A board with `network_login` on answers `info`, `auth_challenge` and `auth` and nothing else until the client has logged in. The app handles it in the session:

- When `settings_get` or any later command answers `unauthorized`, the session tries the token it kept in memory, if it has one. When it has none, or the board refuses it, the page shows the login screen.
- The token is typed as 16 characters from `a-z` and `0-9`; anything else is refused at once with "The token has 16 characters, letters from a to z and digits from 0 to 9.", without asking the board.
- The app sends `auth_challenge`, then `auth` with the HMAC-SHA256 of the nonce's 32 characters under the token's 16 characters, as 64 lowercase hexadecimal digits. The hash is the app's own (`web/src/protocol/sha256.ts`, checked against `conformance/net/hash.json`): a board serves the page over plain `http://`, where the browser has no `crypto.subtle`. The token itself is never sent.
- A wrong token says "That token is not right. After three wrong tries Zenit closes the connection." The third wrong token closes the connection (1008), and the app says so (see [WebSocket](#websocket)).
- A command that was refused is run again after the login succeeds.
- The token is kept in the page's memory only, until the page is closed: never in local or session storage, the address, a log or an error message. The token of a USB connection (`settings_get` reports it there) is kept the same way, so the page can log in to the same board over WiFi.
- Turning the login on over WiFi closes the connection after the reply. The switch first asks for confirmation and says so ("Zenit closes this connection, and then asks for the token. ... Make sure you have the token before you continue."); afterwards the app opens the connection again by itself and shows the login screen.
- Commands reserved for USB (`settings_reset`, `wifi_forget`, `token_regenerate`, and the token in `settings_get`) answer `usb_only` or leave the token out over WiFi. The app does not offer them there: it shows the sentence "do it with the USB cable" in place of the button.

### Improv Wi-Fi Serial

Over USB the app sets up the board's WiFi with [Improv Wi-Fi Serial](https://www.improv-wifi.com/serial/) version 1, which shares the port with the protocol lines and the log lines (`web/src/protocol/improv.ts`, `improv-client.ts`).

- **Splitting the stream.** The reader follows `lib/ZenitImprov/src/improv_frame.cpp` byte by byte. A frame starts at the beginning of a line with `IMPROV` and the version byte `01`; then come a type, a length, the data and a checksum (the sum of every earlier byte, modulo 256), and the length decides the end whatever the bytes are, so a newline inside the data is data. Frames may follow each other with no newline, and the board ends each frame it sends with a newline that the checksum does not cover. Every other byte goes to the line reader in order, so a line that starts like a header (`IMPRO...`) stays a line. A frame with a wrong checksum is thrown away, and a frame that stops for 1 second is dropped. A Vitest runs the packets and streams of `conformance/improv/frames.json` through it, whole and one byte at a time.
- **Sending.** An RPC command frame is type `03` with the command byte, the length of the arguments and the arguments. The app writes a newline before it, so the frame starts a line whatever half line the board holds, and no newline after it.
- **Requests.** The client does one request at a time: the current state, the device info, a scan (the results are a name, the signal in dBm and `YES` or `NO` for security; the board names each network once, strongest first, at most 16, and an empty result ends the list; the client waits 20 seconds), and the WiFi settings (35 seconds, a little more than the board's 30). Each has a timeout and ends with a plain error: invalid RPC, unknown RPC, unable to connect, timeout, busy, or a failed link.
- **Passwords.** The name is 1 to 32 bytes of valid UTF-8 without control characters (the board refuses other names) and the password is empty, 8 to 63 characters, or 64 hexadecimal digits; the app checks both before it sends anything. The bytes of the frame are wiped after they are written. The password is in no log, address, storage or error text.

### State and polling

The app keeps the board's `info`, `settings` (from `settings_get` on connect, then from every `settings_set` reply) and `light`, `wifi`, `time` and `update` (from `status`, `light`, `update_check` and `update_install`). While the page is visible, it asks `status` once per second, and never while another request is in flight. Polling stops while the page is hidden and starts with one `status` when it is shown again. The update progress and the WiFi state follow the same poll.

A setting is sent when the user chooses it. A choice is shown at once and replaced by what the board answers. While a slider moves, the app shows the value being chosen and sends nothing; it sends when the pointer is released. A slider moved with the keyboard sends 500 ms after the last key press, or at once when the focus leaves the slider or the view closes, so a run of key presses is one save. If the board answers an error, the app shows it, asks `settings_get` and shows what the board holds.

When the connection is lost (the cable pulled, the socket closed, five tries with no reply), the app shows "Connection lost" in the header with a Reconnect button, and keeps the Light view on screen with the last shown values, greyed and disabled, and a message above them. Reconnect opens the same connection again: the same address, or the same USB port when it still opens (otherwise the browser's chooser). Until it succeeds the last values stay; if it fails, the message says why and the view stays as it was.

Two losses are expected, and the app opens the connection again by itself, quietly, every 3 seconds for about a minute (20 tries):

- **A restart for an update.** The connection drops while the update state is `downloading`, `verifying` or `restarting`. The header says "The board is restarting", the Device and Light views say "Zenit is restarting. It connects again by itself in a few seconds.", and no error banner shows. Over USB the app can only reuse the port it had; a port that is not back yet is tried again. When the tries run out the message is "Zenit did not come back. Check that it is on, then press Reconnect."
- **The login turned on.** The board closes the connection after the reply. The app opens it again after a second and shows the login screen.

A person who presses Disconnect or Reconnect stops the automatic tries.

## WiFi setup

The WiFi card of **Device** shows `status.wifi` in a sentence: "Not set up. Zenit is not on a WiFi network.", "Connecting to "HomeNet"...", "Connected to "HomeNet".", "Zenit cannot see "HomeNet". It keeps trying.", ""HomeNet" refused the password. Zenit keeps trying." or "Zenit joined "HomeNet" but got no address. It keeps trying." While connected it lists the address (`zenit-a1b2.local`), the number and the signal in words. A card is not shown for a board that does not report `wifi`. The card also holds the WiFi strength (`wifi_power`): "Automatic" and the fixed levels in dBm, sent when chosen.

Over a USB connection the card sets the network up with [Improv](#improv-wi-fi-serial):

1. **Scan for networks** lists what the board sees (name, signal in words, "password" or "open"). Choosing one fills the name; a name can also be typed, for a hidden network.
2. **Password.** A field with a Show password and Hide password button, and the note that an empty one is for a network with no password.
3. **Connect Zenit to this network** sends the settings. The page says "Connecting, up to 30 seconds. Keep the USB cable plugged in." and disables the form. On success: "Connected as zenit-a1b2.local. Open http://zenit-a1b2.local/ on your phone or computer to control Zenit over WiFi." The password field is emptied. The failures are plain: "Zenit could not join that network. Check the name and the password, then try again." (and the form stays), "Zenit did not accept that name or password.", "Zenit did not answer. Try again." and "The USB connection failed. Check the cable."
4. **Forget this network** (shown while a network is stored) asks "Forget this WiFi network?" ("Zenit leaves the network and turns its WiFi off. You can set it up again with the USB cable.") and sends `wifi_forget`.

Over a WebSocket connection the card shows the state and says that changing the network, or making Zenit forget it, needs the USB cable. A page on the published `https://` site cannot reach a Zenit by an address at all, so its Connect screen says in one sentence that over WiFi the Zenit's own address is to be opened, and the WiFi card under a USB connection says that, once on WiFi, Zenit is controlled from its own address (`http://zenit-a1b2.local/`).

## Firmware updates

The **Firmware updates** card shows `status.update` and is left out for a board that does not report it:

- **What it found.** A sentence for the last result, in plain words for every `last_result` of [WiFi and updates](../board/wifi-and-updates-v1.md#modes-and-checks): `never` "Zenit has not looked for an update yet.", `up_to_date` "Your Zenit has the latest firmware.", `available` "Version 1.2.0 is available.", `skipped` "A newer version exists, but it did not work on this Zenit before, so Zenit does not install it by itself.", `installed` "The new version was installed. Zenit is restarting.", `no_network`, `no_time`, `unreachable`, `tls_error`, `bad_manifest`, `bad_download`, `flash_error`, each in a sentence of its own, and `not_published` "The project site has no firmware published yet, so there is nothing to install." A result the app does not know is named, not hidden. "Last checked" shows `last_check` in the reader's local time. With updates off the card says so and what to do.
- **What it is doing.** While `state` is not `idle`: "Looking for an update...", "Downloading the update: 42 %" with a progress bar, "Checking the download...", "Restarting to start the new version...". The poll of once a second follows it.
- **Notes.** A firmware on trial ("This firmware is on trial. It confirms itself in a moment, and until then Zenit does not install another one."), a version that was rolled back ("Version 1.1.0 did not work on this Zenit, so Zenit went back to the version it had before."), and the version set aside.
- **Check now** sends `update_check`; it is off while updates are off, while the board is busy or while it is not on WiFi (a sentence says it needs WiFi).
- **Install** shows for a version that is `available` (not while on trial, busy or off WiFi), and asks first: "Zenit downloads the new firmware and then restarts. The light goes dark for a moment and fades in again. Keep Zenit powered until it is back, which takes a minute or so." It sends `update_install` with `target` `firmware`.
- **Install anyway** replaces it for a version on the skip list. Its dialog warns "This version did not work on this Zenit before, and Zenit went back to the earlier one. It may fail the same way. If it does, Zenit goes back again by itself." and sends `force: true`. It is the only place that sends `force`.

The errors `updates_off`, `no_network`, `nothing_to_install` and `busy` have their own sentences (see [Errors](#errors)).

## Board settings

The settings of the WiFi and updates milestone are sent when the user commits them, never while typing: a choice of a list or a switch when it is chosen, a text or number field with its button (or Enter). A choice is shown at once and replaced by what the board answers, as for the light. The limits are constants in `web/src/device/settings.ts`, equal to the protocol's, with a test that compares them.

| Setting           | Control                                         | Label                                  | Limits (protocol)                         |
| ----------------- | ----------------------------------------------- | -------------------------------------- | ----------------------------------------- |
| `wifi_power`      | select                                          | WiFi strength                          | `auto`, `8.5`, `11`, `13`, `15`, `17`, `18.5`, `19.5` |
| `update_mode`     | three option buttons                            | Off, Tell me, Install automatically    | `off`, `notify`, `automatic`              |
| `update_firmware` | switch                                          | Update the firmware                    | boolean                                   |
| `check_hours`     | number field and Set                            | Look for updates every (hours)         | 1 to 168                                  |
| `install_start`, `install_end` | two time fields and Set window     | Install window, From, Until            | 0 to 1,439 minutes, shown as `HH:MM`      |
| `timezone`        | select of common zones, and a text field        | Time zone, Time zone text              | 1 to 64 printable ASCII, no space         |
| `ntp_server`      | text field and Set                              | Time server                            | 1 to 64 of letters, digits, `.`, `-`      |
| `time_sync_hours` | number field and Set                            | Check the time every (hours)           | 1 to 168                                  |
| `network_login`   | switch                                          | Ask for a token to log in              | boolean                                   |

The install window says what it does ("From 23:00 to 02:30 (past midnight)." or "Any time of day.", and that equal times mean any time, and that Zenit installs by itself only inside it) and is off unless the mode is "Install automatically". The time zone select offers UTC and a dozen common zones as POSIX strings; "Another time zone..." shows the text field, which is also shown for a zone the list does not have. An entry out of its limit is refused in the field, with a sentence, and nothing is sent. A reply with a board setting out of its limit is not a valid reply.

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
| `unauthorized`     | Zenit needs the access token first.                                                     |
| `no_network`       | Zenit is not connected to WiFi.                                                         |
| `updates_off`      | Firmware updates are turned off. Turn them on in the Device page.                       |
| `nothing_to_install` | There is no update to install. Check for updates first.                               |
| no valid reply     | Zenit did not answer. Check the cable or the address.                                   |

Errors appear in a banner at the top of the view with a Close button (`role="alert"`), and clear on the next successful request.

## Privacy rules

- The app sends nothing to any outside server: no analytics, no fonts, no scripts, no images, no requests but the files of its own site (including `firmware/manifest.json`, and `/board.json` on a page loaded over `http://`) and the board the user connects to. The privacy page says so, and the content security policy of the page enforces it: `default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'`.
- Settings, the board's details and the address of the board stay in the browser and travel only to the board.
- The browser's local storage holds two values: the theme choice and the last board address. Nothing else is stored. The WiFi password goes from the form to the board over the USB cable and is wiped from the frame buffers after it is written, and the form is emptied. The access token lives in the page's memory until the page is closed; it is never stored, put in an address or sent over the network (the board sees only HMACs of it).
- Installing firmware downloads the firmware file from the same site and writes it to the board over USB. Updating over WiFi is done by the board itself, which reads the project's site and downloads from it; the page only asks the board to start.

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

- **Unit (Vitest, Node):** CRC-32, the strict reader, framing, reply validation, the client with a scripted link (retries, immediate resend on `bad_frame`, one in flight, malformed replies), the protocol conformance cases (every framing case and every command case, with the client's framing and parsing; the simulator's control lines and the close flags are the board's business and are skipped, and a `$pattern` becomes a sample text), the Web Serial transport with a fake port (open options, no `setSignals`, line splitting, close, Improv frames cut out of the stream), the WebSocket transport with a fake socket (the close statuses), the settings model and limits (the light's and the board's), the version comparison, the manifest reader, the address rules, the time formats, SHA-256 and HMAC against `conformance/net/hash.json`, the login, the Improv codec and splitter against `conformance/improv/frames.json`, the Improv client with a scripted link (scan, connect, every failure, timeouts, wiped buffers), the board probe of a served page, the session with a board that logs in, closes connections and restarts, and the update and WiFi sentences.
- **End to end (Playwright, Chromium):** the built app served from a folder with a fixture `firmware/manifest.json`, against `tools/ws_bridge.py` and the simulator (`just sim-build` first): connect, power, brightness on release, every effect with its settings, timer, status, errors, the lost connection and its reconnection, the Device view, the privacy page, the theme, the keyboard, no outside request, a USB connection through a fake Web Serial port wired to a scripted board, the page the simulator's bridge serves with `--app web/dist` (found by `/board.json`, connected by itself, no installer, the login turned on, three wrong tokens), the WiFi card with Improv frames of `conformance/improv/frames.json` played by the fake port, the login and the token with a scripted board, and the update card and settings with a scripted board (checks, installs, forced installs, progress, a restart and the automatic reconnection).
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
| Board probe of a served page           | 2 s                  |
| Improv scan, connect                   | 20 s, 35 s           |
| Automatic reconnection                 | 20 tries, 3 s apart  |
