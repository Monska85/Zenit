# WiFi and updates, version 1

Status: **implemented** by the firmware of milestone 4, with simulator support for tests.

This document specifies how a Zenit board joins a WiFi network, serves the web app and the [command protocol](../protocol/protocol-v1.md) on it, and updates its own firmware from the project's published site, with a trial boot and a rollback. Why it works this way is recorded in [ADR 0004](../adr/0004-wifi-and-updates.md). The commands and settings it mentions are specified in the protocol document, the screens in the [web app specification](../web/web-app-v1.md). The light is specified in [Light](light-v1.md).

## Tasks and memory

Two FreeRTOS tasks share the work (ADR 0001):

- The **loop task** (Arduino's `loop()`, 8,192 bytes of stack) owns the outputs, the settings, the files of the settings memory, the Improv frames and every protocol request, whatever transport it came from. It runs the light tick every 10 ms and never waits for the network.
- The **network task** (12,288 bytes of stack) owns WiFi, mDNS, SNTP, the HTTP and WebSocket server, and the HTTPS checks and downloads. It moves bytes: it never reads or writes the light or the settings, and it never runs a protocol command.

The two talk through static, fixed-size queues (`include/mailbox.h`, no allocation after start):

- Loop task to network task: `Provision` (name and password of an Improv try), `Scan`, `Manifest` (read the update manifest) and `Download` (the firmware). The configuration (the stored network, power, time zone, NTP server, sync interval) is not a queue entry: the loop task writes it under the lock with a generation number and the network task takes it up when the number changes, so it always gets the latest. Closing the WebSocket client goes straight to the server. A command that does not fit the queue is refused: `busy` to an update command, `unable to connect` to an Improv one.
- Network task to loop task: `ClientOpened`, `ClientLine` (one WebSocket message, at most 1,024 bytes), `ClientClosed`, `UpdateChecked`, `UpdateInstalled`. A scan is not a queue entry: the network task keeps the scan state (idle, running, done) in an atomic and the list of networks under the lock, and the loop task reads them; a new scan discards a list nobody has read. The download progress is a value the loop task reads, not a queue entry, so the queue holds only the end of a transfer (one at a time) and cannot fill up; the network task delivers that end even when the queue is briefly full.
- The server task of the HTTP server hands a line to the loop task and waits for its reply, so a request has one reply on its connection, in order.
- The state the loop task reports (`status.wifi`, `status.time`, `status.update`) comes from a **snapshot** the network task writes under a mutex and the loop task copies under the same mutex. Nobody holds the mutex across a call that can block.
- **One large allocation at a time.** A TLS connection (the update check and the firmware download) takes tens of kilobytes. The network task holds a lock while one is open, and the HTTP server answers every new connection with `503` meanwhile. The firmware download writes each chunk straight to the flash, with no copy of the image in memory.

## WiFi

The credentials, the network name and the password, live in the board settings record (see [Stored settings](#stored-settings)). With none stored the state is `not_configured` and the radio stays off.

### States

| State            | Meaning                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `not_configured` | No network is stored.                                                                         |
| `connecting`     | The board is joining the network, or waiting before its next try.                             |
| `connected`      | The board has an address.                                                                     |
| `not_found`      | The last try found no network of that name.                                                   |
| `wrong_password` | The last try was refused by the network (authentication or key exchange failed).              |
| `no_address`     | The board joined the network and got no address within 15 seconds.                            |

The causes come from the reason of the disconnect event: no access point found is `not_found`; authentication failure, handshake timeout, MIC failure and bad credentials are `wrong_password`; any other reason keeps `connecting`. A state other than `connected` and `not_configured` goes on trying.

### Reconnecting

After each failed try the board waits 1, 2, 4, 8, 16 and 32 seconds, then one minute between tries, forever. A successful connection resets the wait. A lost connection starts at 1 second again.

### Transmit power

`wifi_power` sets the transmit power. `auto` starts at the maximum, 19.5 dBm, and drops to 8.5 dBm after 3 failed tries in a row, then stays there until the next restart: some SuperMini boards cannot hold a connection at full power. Any other value is used as given. The power is applied before the radio starts and again on every change of the setting.

### Names

The hostname is `zenit-` and the last two bytes of the WiFi MAC address as four lowercase hexadecimal digits (`zenit-a1b2`). The board announces `zenit-a1b2.local` with mDNS and an `_http._tcp` service on port 80. mDNS, SNTP and the HTTP server are each started once the board has an address, and each one that fails to start is tried again while the board stays connected, after 1, 2, 4 ... 32 s and then every minute.

### Board LED

The blue LED (GPIO 8) blinks at 2 Hz while a connection started by Improv is being made (see [Setup with Improv](#setup-with-improv)) and is off otherwise.

## Setup with Improv

WiFi is set up over USB with [Improv Wi-Fi Serial](https://www.improv-wifi.com/serial/), version 1, implemented from its public specification in `lib/ZenitImprov`. Improv frames and `@ZN` protocol lines share the port: a frame starts with `IMPROV` and the version byte `01`, a protocol line with `@ZN `, and the loop task tells them apart on the first bytes of each.

A frame is `IMPROV`, the version, a type, the length of the data, the data, and a checksum (the sum of every earlier byte of the frame, modulo 256), then a newline. The board accepts the frames of ESP Web Tools and of the Zenit web app:

| RPC command                | Behavior                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01` send WiFi settings    | The data is the name's length, the name, the password's length and the password. A name of 1 to 32 bytes of valid UTF-8 without control characters (so that it is the same text in the JSON of `status.wifi.ssid` on every client; a name from a network that has none such, in a scan, is left out of the list) and a valid password are required (see [Limits](#limits)) or the error is `invalid RPC`. The board states `provisioning`, starts connecting, and within 30 seconds either states `provisioned` and answers with an empty result, or answers `unable to connect` and states `ready`. `status.wifi.ssid` shows the stored network only: a network that is being tried, or that could not be saved, is never shown in it. The credentials are stored only after the connection succeeds, and the success is reported only after they are stored: when the settings memory fails, the board answers `unable to connect`, states `ready` and goes back to the network it had. |
| `02` request current state | The current state, and the empty result when provisioned.                                                                                               |
| `03` request device info   | Four strings: `Zenit`, the firmware version, `ESP32-C3`, the hostname.                                                                                  |
| `04` request WiFi networks | One result per network name seen, for its strongest access point (name, signal in dBm, `YES` or `NO` for security), strongest first, at most 16, then an empty result. The board reads the raw record of each access point: its name is the bytes of the 33-byte field up to the first zero, and a record with any non-zero byte after that zero (`Home` followed by a zero and `Evil`) is left out, never read as `Home`. The board keeps every access point of the scan in mind, one entry per name with its strongest, and then the best 16 names, so many access points of one network never hide another. The scan stops after 15 seconds. A scan sent while a scan or a connection runs gets the empty result at once and does not disturb it; WiFi settings sent while a scan or a connection runs get `unable to connect` and the state the board is in. |

States are `ready` (not provisioned or not connected), `provisioning` and `provisioned`. Every RPC clears the error state first. A frame with a wrong checksum, a wrong type or a data length that does not match is `invalid RPC`; an unknown command is `unknown RPC`. A frame that stops for 1 second is dropped, so a lost byte never swallows the protocol lines after it. Improv frames never reach the protocol core. The board ends every frame it writes with a newline, because clients that read line by line (ESP Web Tools does) need it; the checksum does not cover it. It reads a frame with or without a newline after it, and a frame starts only at the beginning of a line or right after another frame. The length byte decides where a frame ends, whatever the data holds, a newline byte included.

Improv frames and the `@ZN` line reader share the bytes of the port. The Zenit web app on the published `https://` site sets WiFi up this way, because Web Serial needs a secure context; the board's own `http://` page cannot.

## Time

The network task starts SNTP once the board has an address, with `ntp_server`, and syncs again every `time_sync_hours`. The time zone is `timezone`, a POSIX TZ string such as `CET-1CEST,M3.5.0,M10.5.0/3`. The time is `synced` after the first successful sync, and stays so. `status.time.local_minute` is the minute of the day in that zone. Checks and installs need the time: certificate validity depends on it.

## Stored settings

The board settings are a record of 255 bytes, stored in NVS (namespace `zenit`) after the [light record](light-v1.md#stored-settings) in the one blob `settings`, written in one step, so a save is all or nothing even when the power fails during it (the key `board` of earlier firmware is read while the blob is missing). Version 1 is 255 bytes:

| Byte   | Content                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------- |
| 0      | Version, `1`                                                                                      |
| 1      | `wifi_power`: `auto` 0, `8.5` 1, `11` 2, `13` 3, `15` 4, `17` 5, `18.5` 6, `19.5` 7               |
| 2      | `update_mode`: `off` 0, `notify` 1, `automatic` 2                                                 |
| 3      | `update_firmware`, 0 or 1                                                                         |
| 4      | `check_hours`                                                                                     |
| 5..6   | `install_start`, little endian                                                                    |
| 7..8   | `install_end`, little endian                                                                      |
| 9      | `time_sync_hours`                                                                                 |
| 10     | `network_login`, 0 or 1                                                                           |
| 11     | Length of `timezone`                                                                              |
| 12..75 | `timezone`, then zeros                                                                            |
| 76     | Length of `ntp_server`                                                                            |
| 77..140 | `ntp_server`, then zeros                                                                         |
| 141..156 | `token`, 16 characters                                                                          |
| 157    | Length of the WiFi name, 0 when none is stored                                                    |
| 158..189 | The WiFi name, then zeros                                                                       |
| 190    | Length of the WiFi password                                                                       |
| 191..254 | The WiFi password, then zeros                                                                   |

These codes never change meaning. A record of another size or version is replaced by the defaults and a new token. A token that is not 16 characters of `a-z0-9` is made again and every other field loads, the stored WiFi network included: a damaged token must not make the board forget its network. A field out of its range keeps its default and the others load. A new token is made at the first start and written then. `cases` in `conformance/board/record.json` give records and their settings both ways.

`settings_set` with both light and board fields is one write of the blob, so the reply `storage_error` leaves both as they were. No journal is needed: each key of NVS is written atomically, and one key holds both records. Nothing is written when no setting differs. `settings_reset` writes both records with their defaults, a new token and no network; it is one write of the blob too, so when the settings memory fails the reply is `storage_error` and nothing changed.

The update state is a third record, key `update`: the version of the pending installation and the skip list (see [Rollback](#rollback)). It is written by the loop task alone.

### Token

The token is 16 characters from `a-z` and `0-9`, drawn with the hardware random generator (36 symbols, bytes above 251 rejected so each symbol is equally likely), made at the first start before the radio is on, and made again by `token_regenerate` and `settings_reset`. Only `settings_get` over USB and `token_regenerate` over USB report it.

## The served web app

The firmware embeds the built web app (`web/dist`), gzipped, in its flash image: a pre-build script (`scripts/web_assets.py`) compresses every file, writes `web_assets.cpp` with the bytes, the path, the media type and the SHA-256 of each file into the build folder, and fails when `web/dist` is missing (build the web app first: `just build` does it). The firmware installer (ESP Web Tools) is left out: the board serves plain http, where a browser gives no USB port, so the served page shows a note instead of the installer and never loads it. Vite's build manifest (`.vite/manifest.json`, not served) names the files only the installer uses, and the build fails when the manifest or the installer's entry is missing. The bytes are served from flash, so a request allocates nothing.

The board answers on HTTP port 80:

| Request                               | Answer                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /`                               | `index.html`, gzipped (`Content-Encoding: gzip`), `Cache-Control: no-cache`.                                |
| `GET /<path>` of an embedded file     | The file, gzipped, with its media type; files under `assets/` carry a hash in their names and are cached for a year. |
| `GET /board.json`                     | `{"zenit":true,"hostname":"zenit-a1b2","ws":"/ws"}`: how the app knows it is served by a board.             |
| `GET /ws` with a WebSocket handshake  | The protocol (see [WebSocket](#websocket)).                                                                 |
| Any other path                        | `404`, plain text.                                                                                          |
| Any other method                      | `405` with `Allow: GET`.                                                                                    |

Every answer carries `Content-Security-Policy: default-src 'self'; connect-src 'self' ws:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin` and `Connection: close`. The page makes no outside request, as the web app specification requires.

The app, loaded from a board, probes `/board.json` on its own origin; when it gets that object it connects to `ws://<host>/ws` on its own, and the Connect screen shows the board as connected. The Device view then has no firmware installer (it needs Web Serial, which needs HTTPS).

## WebSocket

The protocol over WiFi is specified in the [protocol document](../protocol/protocol-v1.md#websocket). The board implements it on the HTTP server's WebSocket support (`esp_http_server`):

- One client at a time. The HTTP server of ESP-IDF answers a WebSocket handshake by itself and calls the firmware for the frames only, so a connection becomes the client with its first message. A second connection is accepted and closed with status 1013 (try later) at its first message; the simulator's bridge answers HTTP 503 for the same case. A WebSocket connection that has not become the client 10 seconds after it opened is closed, so idle connections cannot fill the server's sockets. Page requests are not affected.
- The `Origin` header is read from the bytes of the handshake as they arrive (the server keeps no headers for the frames) and checked at the first message: missing, the site address the firmware was built with, `localhost`, a `.local` name or a private IPv4 address (10/8, 172.16/12, 192.168/16, 169.254/16, 127/8) pass; anything else is closed with 1008.
- A message over 1,024 bytes after reassembly closes with 1009, a binary message with 1003, a text message with a newline with 1008, and invalid UTF-8 with 1007. Fragments are reassembled; pings are answered by the server; an unmasked client frame is a protocol error (1002).
- A client that vanished (WiFi lost) is detected with TCP keep-alive (15 s idle, 5 s interval, 3 probes) and frees the slot.
- A client that holds the slot and stays silent is not closed by the board while its connection lives; a second client has to wait or the first tab has to close.
- When a connection opens or closes, the WiFi transport forgets its remembered reply and its login.

### Network login

With `network_login` on the client authenticates as the [protocol specifies](../protocol/protocol-v1.md#authentication): the board draws a 16-byte nonce with the hardware random generator, and compares the client's HMAC-SHA256 with its own in constant time. A client that stays unauthenticated for 10 seconds is closed, so one unauthenticated host cannot hold the single slot for long; a person has the token ready before connecting. Three failed `auth` close the connection.

## Updates

### Source

The board reads the **update manifest** from `<site address>firmware/update.json`. The site address is set when the firmware is built (`ZENIT_SITE_URL`, an `https://` URL ending in `/`, default `https://monska85.github.io/Zenit/`; forks and test builds override it) and is also the origin the WebSocket accepts. The address is at most 182 characters (`MAX_SITE_URL`), so that the manifest and firmware URLs, with a file name of 64 characters, fit the 255 characters the board builds; a longer address is a compile error and `tools/site_url.py` refuses it. The manifest is not the ESP Web Tools manifest (`firmware/manifest.json`), which the web app installs from.

```json
{"schema":1,"board":"esp32c3","version":"1.2.0","file":"zenit-esp32c3-firmware.bin","size":412160,"sha256":"<64 lowercase hexadecimal digits>"}
```

The board reads it as strict JSON (the protocol's rules), at most 1,024 bytes, with exactly these fields and no others. `schema` is 1, `board` is `esp32c3`, `version` is `X.Y.Z` without a prerelease, `file` is 1 to 64 characters of `a-z0-9._-`, never starting with a dot, resolved next to the manifest, `size` is a whole number from 65,536 to the slot size (2,031,616), `sha256` is 64 lowercase hexadecimal digits. Anything else is a bad manifest. The release workflow writes it (`tools/pages_site.py`) from the firmware file it publishes, so size and hash are those of the file, and it refuses a file the board would refuse. The web app a board serves is the one embedded in the firmware the board runs; a web release alone does not change it, the next firmware release does, while the published site always has the latest web app.

### Transport

HTTPS only, certificate checked against the ESP-IDF certificate bundle (the framework's full Mozilla bundle) and the host name, redirects not followed, the time out of every read 10 seconds, the whole check 30 seconds and the whole download 10 minutes. The download streams into the inactive slot while a SHA-256 runs over the same bytes. A test build (`esp32c3_test_http`, see [Tests](#tests-and-simulator)) can read from a plain HTTP address on a local test server; the release build cannot, and `scripts/site_url.py` refuses a non-HTTPS site address for it.

While the repository is private the site does not exist, and a check says so: a `404` or `403` is `not_published`.

### Modes and checks

`update_mode` and `update_firmware` decide what the board does with firmware updates; they are on when `update_mode` is not `off` and `update_firmware` is `true`.

| Mode        | Checks                                  | Installs                                                                  |
| ----------- | --------------------------------------- | ------------------------------------------------------------------------- |
| `off`       | none (`update_check` is `updates_off`)  | none (`update_install` is `updates_off`)                                  |
| `notify`    | every `check_hours`, and on request     | only by `update_install`                                                  |
| `automatic` | every `check_hours`, and on request     | by itself inside the window, and by `update_install` at any time          |

The first check runs 2 minutes after the board is connected and its time is synced; later ones every `check_hours` after the last attempt; a failed check is tried again after 30 minutes. A check reads the manifest and compares its version with the running one by semantic versioning precedence. The result is one of:

| `last_result`   | Meaning                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------- |
| `never`         | No check yet since the start.                                                            |
| `up_to_date`    | The published version is not newer than the running one.                                 |
| `available`     | A newer version was found (`available` holds it).                                        |
| `skipped`       | The newer version is on the skip list: it is reported but not installed by itself.       |
| `installed`     | A newer version was installed and the board is restarting.                               |
| `no_network`    | The board is not connected.                                                              |
| `no_time`       | The time is not synced yet.                                                              |
| `unreachable`   | The site did not answer, or the connection failed.                                       |
| `not_published` | The site answered `404` or `403`: nothing is published there (a private repository).     |
| `tls_error`     | The certificate was refused.                                                             |
| `bad_manifest`  | The manifest is not valid.                                                               |
| `bad_download`  | The download is not the size or the SHA-256 the manifest gave, or ended early.           |
| `flash_error`   | The slot could not be written or activated.                                              |

### Install window

In `automatic` mode the board installs only inside the window from `install_start` to `install_end` (minutes after midnight, in `timezone`). Equal values mean the whole day. An end before the start runs over midnight. When the window is narrower than the whole day and the time is not known, nothing is installed. The loop task decides once a minute. `update_install` ignores the window, never the mode.

### Install

The install runs only when the board is idle, not on trial, connected and synced, and the version is newer than the running one (no downgrade over the network, and `force` does not lift that). The network task downloads to the inactive slot, checks size and SHA-256 at the end, and reports. The loop task then stores the pending installation in the update record, and only then does the board activate the slot and restart. If anything fails before the activation, the running firmware and slot are untouched and the state is `idle` with the result.

- The light keeps running during the download, with no change: the loop task never waits for the network. During the flash writes the light stays as it is. After the restart the light fades in as at every start.
- The outputs have their safe state at every restart: every channel low before the PWM attaches, as at any boot.
- The update status reports `downloading` with a progress percentage, then `verifying`, then `restarting`.

### Status

`status.update` holds:

| Field         | Meaning                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| `mode`        | The `update_mode` setting, or `off` when `update_firmware` is `false`.                                      |
| `state`       | `idle`, `checking`, `downloading`, `verifying` or `restarting`.                                             |
| `available`   | The newer version found by the last check, or `null`.                                                       |
| `last_check`  | The Unix time of the last finished check, or `null`.                                                        |
| `last_result` | One of the results above.                                                                                   |
| `progress`    | A whole percentage while `downloading`, else `null`.                                                        |
| `trial`       | `true` while this firmware runs on trial (before it confirmed itself).                                      |
| `skipped`     | The version on the skip list, or `null`.                                                                    |
| `rolled_back` | The version that failed its trial the last time and was rolled back, or `null`.                             |

### Rollback

The bootloader is built with app rollback (`CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`, in the Arduino-ESP32 libraries the project uses). A new firmware boots **on trial**: the firmware overrides `verifyRollbackLater()` so the bootloader keeps the image pending after `setup()`. The loop task confirms the firmware after the **health check**: the settings were read (the settings memory opened), the first output frame was written, and the protocol started. This is on the first pass of the loop, normally under a second. Confirming marks the image valid; if the board restarts or crashes before that, the bootloader boots the previous firmware again. A health check that fails without a crash marks the image invalid and restarts at once. Power lost during the trial counts as a failure. Rollback is always on; no setting turns it off.

At each boot the firmware reads the update record and the state of the slots:

| Boot                                                        | Update record has a pending version | Outcome                                                                                           |
| ----------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| Trial, health check passes                                  | the running version                 | The image is marked valid and the pending version is dropped; the skip ends if it was the same.   |
| Trial, health check passes                                  | none or another version             | The image is marked valid (a firmware put there another way); nothing else changes.               |
| Trial, health check fails                                   | any                                 | The image is marked invalid and the board restarts: the previous firmware boots.                  |
| Not a trial, the other slot is marked invalid               | a version that is not running, and it started | A rollback: the pending version goes on the skip list and `rolled_back`, the pending record is dropped. |
| Not a trial, the other slot is marked invalid               | a version that is not running, and it never started | The slot is marked from an earlier rollback and the power went before the switch: the pending record is dropped, with no skip. |
| Not a trial, no invalid slot                                | a version that is not running       | The board lost power before the switch: the pending record is dropped, with no skip.              |
| Not a trial                                                 | the running version                 | The confirmation was lost to a power cut: the pending record is dropped.                          |
| Any                                                         | none                                | Nothing happens.                                                                                  |

The update record keeps a flag, `booted`, that the pending image sets itself when it starts on trial, before its health check, and stores before it confirms: the evidence that the installation ran. A rollback is declared only with it, because the slot an earlier rollback marked invalid stays marked, so a power cut between storing the pending version and switching the boot slot would otherwise skip a version that never ran. An image that fails before it can store the flag is dropped without a skip and offered again at the next check. The skip list holds one version, the last that rolled back. A newer release ends the skip. Automatic installs never install the skipped version; `update_install` with `force` does, and it is the only use of `force`. A downgrade is never installed over the network. A firmware flashed over USB can be any version.

## Protocol over WiFi

All commands of the protocol work over WiFi except the ones reserved for USB: `settings_reset`, `wifi_forget`, `token_regenerate` and the `token` in `settings_get` answer or omit as the protocol says. The reply to a command that changes the network (`wifi_forget`, USB only) is sent before the radio goes off. Commands run on the loop task like any other; a request that arrives while the loop task is busy waits in the mailbox queue, and a full queue closes the connection with 1013.

## Security

- The WiFi password and the token are never logged, never put in a reply other than `settings_get` and `token_regenerate` over USB, and wiped from the Improv buffers after use.
- The served page and every answer carry the headers above. The server reads at most 1,024 bytes of a request path and 512 bytes of the headers it uses.
- Updates are checked for integrity (SHA-256 from an HTTPS manifest) and cannot downgrade. They are not signed: whoever controls the site controls the firmware. Signing is out of scope for version 1 and recorded in ADR 0004.
- With `network_login` off (the default) the home network is trusted: any client on it can change every setting a WiFi client may change, `ntp_server` and `timezone` included. Turn the login on where that is not so.
- `ws://` and `http://` are not encrypted: anyone on the home network sees what the app and the board exchange, and the token never crosses the network, only HMACs of it.

## Tests and simulator

- Pure logic in `lib/ZenitNet`, `lib/ZenitImprov` and `lib/ZenitUpdate` has native tests; the protocol, the board record and the update manifest have conformance cases under `conformance/`.
- The simulator has the same module boundaries as the board: `network_sim`, `firmware_sim` and an update source that serves a scripted manifest. Failure injection (control lines of `--protocol`): no network, a bad hash, a failed trial, a rollback, a failing flash write.
- `tools/ws_bridge.py --transport wifi` serves the simulator as a board on WiFi: login, `usb_only`, one client, and `--app web/dist` serves the built app and `/board.json` on the same port, so the served-by-board mode is tested end to end.
- A test firmware (`esp32c3_test_http`) accepts an `http://` site address for a local test server. It is never released.

## Board test plan

What needs a real WiFi network, a phone and a real release. Over USB alone the firmware boots, confirms itself, answers Improv frames, keeps the board settings and token, forgets the network and reports `not_configured` and `no_network` (tested on a bare board, see [Measurements](#measurements)). The rest is tested with the owner:

1. **Join the network.** From the published site over USB (Device page), pick the home network, give the password: the board LED blinks, then the page says the board is connected and shows `zenit-XXXX.local`. A wrong password ends with the plain message and the board keeps trying nothing new (the stored network is unchanged). `status.wifi.state` shows `connected`, the name, a signal and an address. Try a name that is not there (`not_found`) and a wrong password stored by hand (`wrong_password`).
2. **Use it from a phone.** Open `http://zenit-XXXX.local/` (and the address shown): the app loads without a Connect screen, controls the light, shows the WiFi and update cards. Open it in a second tab: the second connection closes at once (try later); close the first and the second works. Pull the WiFi off the router and bring it back: the board reconnects by itself after the waits of [Reconnecting](#reconnecting).
3. **Transmit power.** With `wifi_power` `auto` on a board that cannot hold the connection at full power, check the fallback to 8.5 dBm (the log line and a stable connection); try each fixed value.
4. **Network login.** Turn it on from the phone: the connection closes and the app asks for the token (printed over USB by `settings-get`); three wrong tokens close the connection; the right one works; `token_regenerate` over USB closes the client and the old token fails. The command line client works with `--token`.
5. **Time.** `status.time` shows the synced time and the right local minute for the time zone, also after a restart and after the router loses the Internet.
6. **Updates with the test firmware.** Build `just build-update-test http://<computer>:8000/` (flash it over USB), serve a newer firmware file with `just update-server`, then: a check says `available`; an install downloads while the light keeps running without a flicker, the board restarts, the new firmware reports `trial` and confirms itself within seconds; `settings` and the network are kept. Serve a file with a wrong hash or a short file (`bad_download`), stop the server during a download (`unreachable`), and serve the same version (`up_to_date`).
7. **Rollback.** Install a firmware, then cut the power within a second of the restart: the board must come back on the old firmware and report `rolled_back` and `skipped`. (The bench check of the other paths is the native tests, which model every row of the table.)
8. **Real release.** When the repository is public and a release is published: the check reads `https://monska85.github.io/Zenit/firmware/update.json` over HTTPS with the certificate bundle (`unreachable` or `tls_error` mean the time or the certificate), reports `available` for a newer release, and the install of the real file works. Until then the result is `not_published`.
9. **Memory.** With WiFi connected, a page open and an install in progress, read the stack lines on the USB log (`loop stack`, `network stack`, `heap`) and compare them with the figures below.

## Limits

| Limit                       | Value                                        |
| --------------------------- | -------------------------------------------- |
| WiFi name                   | 1 to 32 bytes of valid UTF-8, no control character (C0, DEL) |
| WiFi password               | empty, 8 to 63 characters, or 64 hexadecimal digits |
| WebSocket message           | 1,024 bytes (the protocol's line limit)      |
| Update manifest             | 1,024 bytes                                  |
| Firmware size               | 65,536 to 2,031,616 bytes                    |
| WebSocket clients           | 1                                            |
| HTTP sockets                | 5                                            |
| Improv frame data           | 255 bytes                                    |
| Scan results                | 16                                           |
| Connection by Improv        | 30 s                                         |
| Download                    | 10 minutes                                   |


## Measurements

On the bare ESP32-C3 SuperMini over USB, with no WiFi network (2026-11-22), with the milestone 4 firmware:

- The firmware is 1,485,232 bytes, 73.1 % of its 2,031,616-byte slot, which leaves 546,384 bytes (the web app inside is about 163 KB gzipped, without the installer).
- The loop task's lowest free stack is 5,080 bytes of 8,192 after `info`, `settings_get` and `status` (the milestone 2 firmware had 5,044 after every command).
- The network task's lowest free stack is 8,256 bytes of 12,288 after a scan with the radio on. A TLS connection (check, download) and the HTTP server's own task are not measured: they need a network, see the [test plan](#board-test-plan).
- The heap has about 214,000 bytes free with the radio off (largest block 114,676); during a scan its lowest was 148,812 bytes.
- Boot and trial: the firmware boots, and an image the bootloader marks as pending verification confirms itself within a second (otadata state went from new to valid), tested on the second slot with a hand-made otadata.
- Over USB: Improv answers current state, device info (`Zenit`, version, `ESP32-C3`, `zenit-XXXX`), unknown command, bad checksum, invalid network, and scans the networks in range; `update_check` and `update_install` answer `no_network`; `wifi_forget`, `token_regenerate`, `settings_reset` and the board settings work and persist.
