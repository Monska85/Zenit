# WiFi and updates, version 1

Status: **implemented** by the firmware of milestone 4, with simulator support for tests.

This document specifies how a Zenit board joins a WiFi network, serves the web app and the [command protocol](../protocol/protocol-v1.md) on it, and updates its own firmware and its web app from the project's published site, the firmware with a trial boot and a rollback. Why it works this way is recorded in [ADR 0004](../adr/0004-wifi-and-updates.md) and, for the web app's own partition, [ADR 0005](../adr/0005-web-app-partition.md). The commands and settings it mentions are specified in the protocol document, the screens in the [web app specification](../web/web-app-v1.md). The light is specified in [Light](light-v1.md).

## Tasks and memory

Two FreeRTOS tasks share the work (ADR 0001):

- The **loop task** (Arduino's `loop()`, 8,192 bytes of stack) owns the outputs, the settings, the files of the settings memory, the Improv frames and every protocol request, whatever transport it came from. It runs the light tick every 10 ms and never waits for the network.
- The **network task** (12,288 bytes of stack) owns WiFi, mDNS, SNTP, the HTTP and WebSocket server, and the HTTPS checks and downloads. It moves bytes: it never reads or writes the light or the settings, and it never runs a protocol command.

The two talk through static, fixed-size queues (`include/mailbox.h`, no allocation after start):

- Loop task to network task: `Provision` (name and password of an Improv try), `Scan`, `Manifest` (read an update manifest) and `Download` (the firmware or the web image), each of the last two with its target: the firmware or the web app. The configuration (the stored network, power, time zone, NTP server, sync interval) is not a queue entry: the loop task writes it under the lock with a generation number and the network task takes it up when the number changes, so it always gets the latest. Closing the WebSocket client goes straight to the server. A command that does not fit the queue is refused: `busy` to an update command, `unable to connect` to an Improv one.
- Network task to loop task: `ClientOpened`, `ClientLine` (one WebSocket message, at most 1,024 bytes), `ClientClosed`, `UpdateChecked`, `UpdateInstalled`. A scan is not a queue entry: the network task keeps the scan state (idle, running, done) in an atomic and the list of networks under the lock, and the loop task reads them; a new scan discards a list nobody has read. The download progress is a value the loop task reads, not a queue entry, so the queue holds only the end of a transfer (one at a time) and cannot fill up; the network task delivers that end even when the queue is briefly full.
- The server task of the HTTP server hands a line to the loop task and waits for its reply, so a request has one reply on its connection, in order.
- The state the loop task reports (`status.wifi`, `status.time`, `status.update`) comes from a **snapshot** the network task writes under a mutex and the loop task copies under the same mutex. Nobody holds the mutex across a call that can block.
- **One large allocation at a time.** A TLS connection (the update checks and the downloads) takes tens of kilobytes. The network task holds a lock while one is open, and the HTTP server answers every new connection with `503` meanwhile. A download writes each chunk straight to the flash, with no copy of the image in memory (a web install keeps only the image's first 4,096 bytes, its header, in memory until the end).

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
| `01` send WiFi settings    | The data is the name's length, the name, the password's length and the password. A name of 1 to 32 bytes of valid UTF-8 without control characters (so that it is the same text in the JSON of `status.wifi.ssid` on every client; a name from a network that has none such, in a scan, is left out of the list) and a valid password are required (see [Limits](#limits)) or the error is `invalid RPC`. The board states `provisioning`, starts connecting, and within 32 seconds either states `provisioned` and answers with an empty result, or answers `unable to connect` and states `ready`. The try has 30 seconds from the request, and the network task, which runs it, decides the outcome: when it is busy with a scan, a check or a download and takes the request after its 30 seconds, the try fails without touching the radio, and a connection made after them is not a success. The loop task, which answers, waits 2 seconds longer, so a try it gave up on can never leave the radio on a network that was not saved; should a success still arrive for it, the radio goes back to the stored network. `status.wifi.ssid` shows the stored network only: a network that is being tried, or that could not be saved, is never shown in it. The credentials are stored only after the connection succeeds, and the success is reported only after they are stored: when the settings memory fails, the board answers `unable to connect`, states `ready` and goes back to the network it had. |
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
| 3      | Bit 0: `update_firmware`. Bit 1: `update_web` is `false` (so a record written before the setting reads as `true`). 0 to 3 |
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

A record the settings memory fails to read (an error other than a missing key) is never written over, since it may hold good settings. After such an error on the settings blob, the board runs on the defaults with a token made in RAM, every save answers `storage_error` (one that changes nothing too), and the next start that reads the blob finds it as it was. After such an error on the update record, firmware updates wait and that record is not written. Each record is judged on its own read: a failed read of one never stops a write of the other, which is a separate key. On a trial boot either error fails the health check, so the previous firmware boots.

### Token

The token is 16 characters from `a-z` and `0-9`, drawn with the hardware random generator (36 symbols, bytes above 251 rejected so each symbol is equally likely), made at the first start before the radio is on, and made again by `token_regenerate` and `settings_reset`. Only `settings_get` over USB and `token_regenerate` over USB report it.

## The served web app

The web app is not part of the firmware: it is one read-only image in its own flash partition, `www`, updated on its own (see [Web updates](#web-updates)). The firmware maps the partition into memory at the start and serves the files from there, so a request allocates nothing. The firmware installer (ESP Web Tools) is left out of the image: the board serves plain http, where a browser gives no USB port, so the served page shows a note instead of the installer and never loads it.

### Flash layout

| Name       | Type | SubType  | Offset     | Size       |
| ---------- | ---- | -------- | ---------- | ---------- |
| `nvs`      | data | nvs      | `0x9000`   | `0x5000`   |
| `otadata`  | data | ota      | `0xe000`   | `0x2000`   |
| `app0`     | app  | ota_0    | `0x10000`  | `0x1B0000` |
| `app1`     | app  | ota_1    | `0x1C0000` | `0x1B0000` |
| `www`      | data | `0x40`   | `0x370000` | `0x80000`  |
| `coredump` | data | coredump | `0x3F0000` | `0x10000`  |

A firmware slot is 1,769,472 bytes and the firmware must leave at least 64 KiB of it free, checked in CI. The `www` partition is 524,288 bytes.

### Web image

One file, built by `tools/web_image.py` from `web/dist` (`just web-image`) and attached to each web release. Every file is gzipped, in a fixed order and without timestamps, so the same app gives the same image. Vite's build manifest (`.vite/manifest.json`, not in the image) names the files only the installer uses; the build fails when the manifest or the installer's entry is missing. All numbers are little-endian.

The **header** is the first 4,096 bytes; after its fields every byte is zero:

| Bytes  | Field          | Value                                                        |
| ------ | -------------- | ------------------------------------------------------------ |
| 0..3   | `magic`        | `ZWEB`                                                       |
| 4      | `format`       | `1`                                                          |
| 5      | `protocol_min` | the lowest protocol version the app speaks, 1 to 255         |
| 6      | `protocol_max` | the highest, not below `protocol_min`                        |
| 7      | reserved       | `0`                                                          |
| 8..23  | `version`      | the web version, `X.Y.Z` (each part 0 to 999999, no leading zeros), zero-padded |
| 24..25 | `count`        | the number of files, 1 to 64                                 |
| 26..27 | reserved       | `0`                                                          |
| 28..31 | `body_size`    | the bytes after the header                                   |
| 32..63 | `body_sha256`  | the SHA-256 of those bytes                                   |

The **body** (from byte 4,096) is the index, then the files. Each index entry is the path length (1 byte), the path (1 to 127 printable ASCII characters, no backslash, no leading `/`, no `..`), a zero byte, the media type length (1 byte), the media type (1 to 63 printable characters), a zero byte, the offset of the file from the start of the body (4 bytes) and its length (4 bytes). A file starts after the index and lies inside the body. `index.html` is one of the files, and no path appears twice. The protocol range comes from `web/src/protocol/speaks.json`, which the app's client also uses to accept a board; the tool refuses an app whose range does not hold the protocol of the firmware in the same commit. Each firmware release attaches `zenit-esp32c3-protocol.txt`, the protocol it speaks, and the site is not built when the latest web image does not speak the protocol of the latest firmware release, so the installer never pairs them wrongly; a board whose firmware a published app does not speak reports it as `incompatible` and keeps its own.

The board reads the image at the start and after each install: the magic, the format, the reserved bytes, the version, the range, the count, the body size, the SHA-256 of the body and every index entry. A published image file is exactly its header and its body; the partition holds `0xFF` after them. The cases in `conformance/update/web_image.json` are read by the board's reader and by the release tools' reader alike.

### State of the web app

| State          | Meaning                                                          | The board serves      |
| -------------- | ---------------------------------------------------------------- | --------------------- |
| `ok`           | A valid image whose protocol range holds the firmware's protocol | the app               |
| `installing`   | A web install is writing the partition                           | the emergency page    |
| `missing`      | No valid image (never installed, cut short, or damaged)          | the emergency page    |
| `incompatible` | A valid image that does not speak the firmware's protocol        | the emergency page    |

### Answers

The board answers on HTTP port 80:

| Request                               | Answer                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /`                               | `index.html`, gzipped (`Content-Encoding: gzip`), `Cache-Control: no-cache`.                                |
| `GET /<path>` of a file of the image  | The file, gzipped, with its media type; files under `assets/` carry a hash in their names and are cached for a year. |
| `GET /board.json`                     | `{"zenit":true,"hostname":"zenit-a1b2","ws":"/ws"}`: how the app knows it is served by a board.             |
| `GET /ws` with a WebSocket handshake  | The protocol (see [WebSocket](#websocket)).                                                                 |
| Any other path                        | `404`, plain text.                                                                                          |
| Any other method                      | `405` with `Allow: GET`.                                                                                    |

While the state is not `ok`, every path but `/board.json` and `/ws` gets the **emergency page** with `503` and `Cache-Control: no-store`: a page of the firmware, at most 4,096 bytes, with no script, that reloads itself every 30 seconds (`<meta http-equiv="refresh">`). When web updates are on it says "The Zenit app is being installed. This page reloads by itself."; when they are off it says the app is missing and names the site to install it from over USB, as text. `/board.json` and the WebSocket answer in every state, so the command line client and an open page keep working.

Every answer carries `Content-Security-Policy: default-src 'self'; connect-src 'self' ws:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin` and `Connection: close`. The page makes no outside request, as the web app specification requires.

The app, loaded from a board, probes `/board.json` on its own origin; when it gets that object it connects to `ws://<host>/ws` on its own, and the Connect screen shows the board as connected. The Device view then has no firmware installer (it needs Web Serial, which needs HTTPS).

## WebSocket

The protocol over WiFi is specified in the [protocol document](../protocol/protocol-v1.md#websocket). The board implements it on the HTTP server's WebSocket support (`esp_http_server`):

- One client at a time. The HTTP server of ESP-IDF answers a WebSocket handshake by itself and calls the firmware for the frames only, so a connection becomes the client with its first message. A second connection is accepted and closed with status 1013 (try later) at its first message; the simulator's bridge answers HTTP 503 for the same case. A WebSocket connection that has not become the client 10 seconds after it opened is closed, so idle connections cannot fill the server's sockets. A page connection closes as soon as its answer is out; one still open 5 seconds after it opened has sent no request (browsers open connections ahead of time) and is closed for the same reason. The server has 5 sockets.
- The `Origin` header is read from the bytes of the handshake as they arrive (the server keeps no headers for the frames) and checked at the first message: missing, the site address the firmware was built with, `localhost`, a `.local` name or a private IPv4 address (10/8, 172.16/12, 192.168/16, 169.254/16, 127/8) pass; anything else is closed with 1008.
- A message over 1,024 bytes after reassembly closes with 1009, a binary message with 1003, a text message with a newline with 1008, and invalid UTF-8 with 1007. Fragments are reassembled; pings are answered by the server; an unmasked client frame is a protocol error (1002).
- A client that vanished (WiFi lost) is detected with TCP keep-alive (15 s idle, 5 s interval, 3 probes) and frees the slot.
- A client that holds the slot and stays silent is not closed by the board while its connection lives; a second client has to wait or the first tab has to close.
- When a connection opens or closes, the WiFi transport forgets its remembered reply and its login.

### Network login

With `network_login` on the client authenticates as the [protocol specifies](../protocol/protocol-v1.md#authentication): the board draws a 16-byte nonce with the hardware random generator, and compares the client's HMAC-SHA256 with its own in constant time. A client that stays unauthenticated for 10 seconds is closed, so one unauthenticated host cannot hold the single slot for long; a person has the token ready before connecting. Three failed `auth` close the connection.

## Updates

### Source

The board reads the **update manifest** from `<site address>firmware/update.json`. The site address is set when the firmware is built (`ZENIT_SITE_URL`, an `https://` URL ending in `/`, default `https://monska85.github.io/Zenit/`; forks and test builds override it) and is also the origin the WebSocket accepts. The address is at most 182 characters (`MAX_SITE_URL`), so that the manifest and firmware URLs, with a file name of 64 characters, fit the 255 characters the board builds; a longer address is a compile error and `tools/site_url.py` refuses it. The manifest is not the ESP Web Tools manifest (`firmware/manifest.json`), which the web app installs from, and which writes the latest web image at the `www` offset too, so a board installed over USB has the app at once.

```json
{"schema":1,"board":"esp32c3","version":"1.2.0","file":"zenit-esp32c3-firmware.bin","size":412160,"sha256":"<64 lowercase hexadecimal digits>"}
```

The board reads it as strict JSON (the protocol's rules), at most 1,024 bytes, with exactly these fields and no others. `schema` is 1, `board` is `esp32c3`, `version` is `X.Y.Z` without a prerelease, `file` is 1 to 64 characters of `a-z0-9._-`, never starting with a dot, resolved next to the manifest, `size` is a whole number from 65,536 to the slot size (1,769,472), `sha256` is 64 lowercase hexadecimal digits. One line break (LF or CRLF) at the end of the file is not part of the JSON. Anything else is a bad manifest. The release workflow writes it (`tools/pages_site.py`) from the firmware file it publishes, so size and hash are those of the file, and it refuses a file the board would refuse.

### Transport

HTTPS only, certificate checked against Espressif's common certificate bundle (the 43 roots of esp-idf's `cmn_crt_authorities.csv`, [`certs/README.md`](../../certs/README.md)) and the host name, redirects not followed, the time out of every read 10 seconds, each manifest read 30 seconds and the whole download 10 minutes. A download streams into the inactive slot or the `www` partition while a SHA-256 runs over the same bytes. Both updates use the same transport. A test build (`esp32c3_test_http`, see [Tests](#tests-and-simulator)) can read from a plain HTTP address on a local test server; the release build cannot, and `scripts/site_url.py` refuses a non-HTTPS site address for it.

While the repository is private the site does not exist, and a check says so: a `404` or `403` is `not_published`.

### Modes and checks

`update_mode` and `update_firmware` decide what the board does with firmware updates; they are on when `update_mode` is not `off` and `update_firmware` is `true`. Web updates follow `update_mode` and `update_web` the same way (see [Web updates](#web-updates)).

| Mode        | Checks                                  | Installs                                                                  |
| ----------- | --------------------------------------- | ------------------------------------------------------------------------- |
| `off`       | none (`update_check` is `updates_off`)  | none (`update_install` is `updates_off`)                                  |
| `notify`    | every `check_hours`, and on request     | only by `update_install`                                                  |
| `automatic` | every `check_hours`, and on request     | by itself inside the window, and by `update_install` at any time          |

The first check runs 2 minutes after the board is connected and its time is synced; later ones every `check_hours` after the last attempt; a check in which a manifest failed is tried again after 30 minutes. A check reads the firmware manifest when firmware updates are on, then the web manifest when web updates are on, one connection at a time, and compares each version with the running one by semantic versioning precedence. The result of each is one of:

| `last_result`   | Meaning                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------- |
| `never`         | No check yet since the start.                                                            |
| `up_to_date`    | The published version is not newer than the running one.                                 |
| `available`     | A newer version was found (`available` holds it).                                        |
| `skipped`       | The newer version is on the skip list: it is reported but not installed by itself.       |
| `installed`     | A newer version was installed: the firmware is restarting, or the web app is in place.   |
| `incompatible`  | Web only: a newer web app that does not speak the firmware's protocol: not installed.    |
| `no_network`    | The board is not connected.                                                              |
| `no_time`       | The time is not synced yet.                                                              |
| `unreachable`   | The site did not answer, or the connection failed.                                       |
| `not_published` | The site answered `404` or `403`: nothing is published there (a private repository).     |
| `tls_error`     | The certificate was refused.                                                             |
| `bad_manifest`  | The manifest is not valid.                                                               |
| `bad_download`  | The download is not the size or the SHA-256 the manifest gave, or ended early.           |
| `flash_error`   | The slot could not be written or activated.                                              |

### Web updates

The board reads the **web manifest** from `<site address>web/update.json`, with the same transport, strict JSON, size limit and line break rule as the firmware manifest:

```json
{"schema":1,"version":"1.3.0","file":"zenit-web-1.3.0.bin","size":171520,"sha256":"<64 lowercase hexadecimal digits>","protocol_min":1,"protocol_max":1}
```

Exactly these seven fields: `schema`, `version` (at most 16 characters, as the image's header holds), `file` and `sha256` as in the firmware manifest, `size` a whole number from 4,097 to 524,288, and `protocol_min` and `protocol_max` whole numbers from 1 to 255, `protocol_min` not above `protocol_max`. The release workflow writes it from the image it publishes.

- **Setting:** `update_web`, default `true`. Web updates are on when `update_mode` is not `off` and `update_web` is `true`.
- **Offer:** a web version is `available` when its range holds the firmware's protocol and it is newer than the image in the partition, or the image is not `ok` (missing or `incompatible`: then any compatible version replaces it, an older one too); a candidate whose range does not hold the firmware's protocol is `incompatible`.
- **Install:** in `automatic` mode inside the [install window](#install-window), or by `update_install` with `target` `web`. A firmware install and a web install never run together; when both are available, the firmware goes first. The board does not restart, and the light keeps running.
- **Install steps:** the state is `installing` from the start (the server waits for any file it is sending first, and stops serving the app). Keep the first 4,096 bytes of the download (the header) in memory and check them before anything is erased: the header must read, carry the version the manifest offered, speak the firmware's protocol and announce a body that fills the manifest's size. A header that does not is a `bad_download` and leaves the old image as it was. Then erase the old header with the first body sector, erase each later sector just before its first byte and write the bytes as they arrive while a SHA-256 runs over the whole download; check size and SHA-256 against the manifest; write the header; read the image as at the start. A power cut or a failure after the first erase leaves no header, so the partition reads as `missing`, never as half an image. A `bad_download` drops the offer, so the next try starts with a new check.
- **After an install:** the board closes the WebSocket client with code `1012`; the app reloads the page when it sees that code.
- **Repair:** when the state is `missing` or `incompatible`, the board is connected and synced, and web updates are on, the board checks and installs at once, whatever the window, `notify` and the state of the firmware's update record (only a firmware on trial waits, for the second its health check takes). A failed repair (a failed check or install, or a check that finds nothing to install) is tried again after 1 minute, then 2, 4, 8 and so on up to 60 minutes, each wait varied from 80 % to 120 % at random so boards do not ask together. The wait goes back to 1 minute after a success, a new connection or a restart. While a repair is needed, its waits alone decide when the board checks, the ordinary schedule waits.
- **Firmware rollback** does not touch the web image. If the firmware that comes back does not speak the image's protocol, the state becomes `incompatible` and the repair starts.

### Install window

In `automatic` mode the board installs only inside the window from `install_start` to `install_end` (minutes after midnight, in `timezone`). Equal values mean the whole day. An end before the start runs over midnight. When the window is narrower than the whole day and the time is not known, nothing is installed. The loop task decides once a minute. `update_install` ignores the window, never the mode.

### Install

The install runs only when the board is idle, not on trial, connected and synced, and the version is newer than the running one (no downgrade over the network, and `force` does not lift that). The network task downloads to the inactive slot, checks size and SHA-256 at the end, and reports. The loop task then stores the pending installation in the update record, and only then does the board activate the slot and restart. If anything fails before the activation, the running firmware and slot are untouched and the state is `idle` with the result.

- The light keeps running during the download, with no change: the loop task never waits for the network. During the flash writes the light stays as it is. After the restart the light fades in as at every start.
- The outputs have their safe state at every restart: every channel low before the PWM attaches, as at any boot.
- The update status reports `downloading` with a progress percentage, then `verifying`, then `restarting`.

### Status

`status.update` holds the firmware's side, the transfer running and the web app's side:

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
| `target`      | What `state` and `progress` refer to: `firmware`, `web`, or `null` while idle.                              |
| `web`         | The web app: `state` (`ok`, `installing`, `missing`, `incompatible`), `version` (of the valid image, or `null`), `available` (the newer compatible version the last check found, or `null`), `last_result` (one of the results above) and `retry_in` (the seconds to the next repair try, or `null`). |

### Rollback

The bootloader is built with app rollback (`CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`, in the Arduino-ESP32 libraries the project uses). A new firmware boots **on trial**: the firmware overrides `verifyRollbackLater()` so the bootloader keeps the image pending after `setup()`. The loop task confirms the firmware after the **health check**: the settings were read (the settings memory opened, and neither the settings nor the update record failed to read), the first output frame was written, and the protocol started. This is on the first pass of the loop, normally under a second. Confirming marks the image valid; if the board restarts or crashes before that, the bootloader boots the previous firmware again. A health check that fails without a crash marks the image invalid and restarts at once. Power lost during the trial counts as a failure. Rollback is always on; no setting turns it off.

At each boot the firmware reads the update record and the state of the slots:

| Boot                                                        | Update record has a pending version | Outcome                                                                                           |
| ----------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| Trial, health check passes                                  | the running version                 | The image is marked valid and the pending version is dropped; the skip ends if it was the same.   |
| Trial, health check passes                                  | another version                     | The image reports another version than the one it was installed as (its release's manifest and image disagree): it is marked valid, and the pending version goes on the skip list without `rolled_back`, so it is not installed again by itself. |
| Trial, health check passes                                  | none                                | The image is marked valid (a firmware put there another way); nothing else changes.               |
| Trial, health check fails                                   | any                                 | The image is marked invalid and the board restarts: the previous firmware boots.                  |
| Not a trial, the other slot is marked invalid               | a version that is not running, and it started | A rollback: the pending version goes on the skip list and `rolled_back`, the pending record is dropped. |
| Not a trial, the other slot is marked invalid               | a version that is not running, and it never started | The slot is marked from an earlier rollback and the power went before the switch: the pending record is dropped, with no skip. |
| Not a trial, no invalid slot                                | a version that is not running       | The board lost power before the switch: the pending record is dropped, with no skip.              |
| Not a trial                                                 | the running version                 | The confirmation was lost to a power cut: the pending record is dropped.                          |
| Any                                                         | none                                | Nothing happens.                                                                                  |

The update record keeps a flag, `booted`, that the pending image sets itself when it starts on trial, before its health check, and stores before it confirms: the evidence that the installation ran. It is set whatever version the image reports, since a trial boot only follows the activation of the installed image, so an image that reports another version and fails its trial is skipped as well. A rollback is declared only with it, because the slot an earlier rollback marked invalid stays marked, so a power cut between storing the pending version and switching the boot slot would otherwise skip a version that never ran. An image that fails before it can store the flag is dropped without a skip and offered again at the next check. The skip list holds one version, the last that rolled back or whose image reported another version. A newer release ends the skip. Automatic installs never install the skipped version; `update_install` with `force` does, and it is the only use of `force`. A downgrade is never installed over the network. A firmware flashed over USB can be any version.

## Protocol over WiFi

All commands of the protocol work over WiFi except the ones reserved for USB: `settings_reset`, `wifi_forget`, `token_regenerate` and the `token` in `settings_get` answer or omit as the protocol says. The reply to a command that changes the network (`wifi_forget`, USB only) is sent before the radio goes off. Commands run on the loop task like any other; a request that arrives while the loop task is busy waits in the mailbox queue, and a full queue closes the connection with 1013.

## Security

- The WiFi password and the token are never logged, never put in a reply other than `settings_get` and `token_regenerate` over USB, and wiped from the Improv buffers after use.
- The served page and every answer carry the headers above. The server reads at most 1,024 bytes of a request path and 512 bytes of the headers it uses.
- Updates are checked for integrity (SHA-256 from an HTTPS manifest) and cannot downgrade. They are not signed: whoever controls the site controls the firmware. Signing is out of scope for version 1 and recorded in ADR 0004.
- With `network_login` off (the default) the home network is trusted: any client on it can change every setting a WiFi client may change, `ntp_server` and `timezone` included. Turn the login on where that is not so.
- `ws://` and `http://` are not encrypted: anyone on the home network sees what the app and the board exchange, and the token never crosses the network, only HMACs of it.

## Tests and simulator

- Pure logic in `lib/ZenitNet`, `lib/ZenitImprov` and `lib/ZenitUpdate` has native tests (the web image reader and the order its writer uses, with a power cut at every step, the repair waits, the emergency page); the protocol, the board record, the update manifest and the web manifest have conformance cases under `conformance/`. The image layout is tested on both sides against the table above: an image built byte by byte in the native tests, and the layout `tools/web_image.py` writes in its own tests.
- The simulator has the same module boundaries as the board: `network_sim`, `firmware_sim`, `www_sim` (the partition in memory, with the board's reader and writer) and an update source that serves scripted manifests and files for each target. It starts with a valid web image, version 1.0.0, that the source also offers. Failure injection (control lines of `--protocol`): no network, a bad hash, a failed trial, a rollback, a failing flash write; for the web app `!www load VERSION MIN MAX`, `!www erase`, `!www fail STEP` and `!update web publish|image|manifest|fail|download ...`.
- `tools/ws_bridge.py --transport wifi` serves the simulator as a board on WiFi: login, `usb_only`, one client, and `--app web/dist` serves the built app and `/board.json` on the same port, so the served-by-board mode is tested end to end. The simulator's line `!close-client CODE` closes the connection with that code (1012 after a web install).
- A test firmware (`esp32c3_test_http`) accepts an `http://` site address for a local test server. It is never released.

## Board test plan

What needs a real WiFi network, a phone and a real release. Over USB alone the firmware boots, confirms itself, answers Improv frames, keeps the board settings and token, forgets the network and reports `not_configured` and `no_network` (tested on a bare board, see [Measurements](#measurements)). The rest is tested with the owner:

1. **Join the network.** From the published site over USB (Device page), pick the home network, give the password: the board LED blinks, then the page says the board is connected and shows `zenit-XXXX.local`. A wrong password ends with the plain message and the board keeps trying nothing new (the stored network is unchanged). `status.wifi.state` shows `connected`, the name, a signal and an address. Try a name that is not there (`not_found`) and a wrong password stored by hand (`wrong_password`).
2. **Use it from a phone.** Open `http://zenit-XXXX.local/` (and the address shown): the app loads without a Connect screen, controls the light, shows the WiFi and update cards. Open it in a second tab: the second connection closes at once (try later); close the first and the second works. Pull the WiFi off the router and bring it back: the board reconnects by itself after the waits of [Reconnecting](#reconnecting).
3. **Transmit power.** With `wifi_power` `auto` on a board that cannot hold the connection at full power, check the fallback to 8.5 dBm (the log line and a stable connection); try each fixed value.
4. **Network login.** Turn it on from the phone: the connection closes and the app asks for the token (printed over USB by `settings-get`); three wrong tokens close the connection; the right one works; `token_regenerate` over USB ends the client's login at once (its next request is `unauthorized`), closes it, and the old token fails. The command line client works with `--token`.
5. **Time.** `status.time` shows the synced time and the right local minute for the time zone, also after a restart and after the router loses the Internet.
6. **Web app.** Flash the firmware without a web image (or erase the image's header): the board serves the emergency page with `503`, repairs the app from the site and the page loads the app. With the test firmware and `just update-server` serving a newer web image (`--web`): the board installs it without a restart, an open page reloads, and the light never flickers. Stop the server halfway through a web install: `missing`, the emergency page, retries after about 1, 2 and 4 minutes, then the repair succeeds when the server is back. Cut the power during a web install: the board starts with `missing` and repairs it. Serve an image whose range does not hold the firmware's protocol: `incompatible`, nothing installed.
7. **Updates with the test firmware.** Build `just build-update-test http://<computer>:8000/` (flash it over USB), serve a newer firmware file with `just update-server`, then: a check says `available`; an install downloads while the light keeps running without a flicker, the board restarts, the new firmware reports `trial` and confirms itself within seconds; `settings` and the network are kept. Serve a file with a wrong hash or a short file (`bad_download`), stop the server during a download (`unreachable`), and serve the same version (`up_to_date`).
8. **Rollback.** Install a firmware, then cut the power within a second of the restart: the board must come back on the old firmware. A cut before the new firmware stores `booted` drops the install without a skip, and the next check offers the version again. A cut on the board practically cannot land between `booted` and the confirmation, because the firmware stores the flag right before it confirms; `rolled_back` and `skipped` come from a new firmware that fails its health check, which the native tests cover with every row of the table.
9. **Real release.** When the repository is public and a release is published: the check reads `https://monska85.github.io/Zenit/firmware/update.json` over HTTPS with the certificate bundle (`unreachable` or `tls_error` mean the time or the certificate), reports `available` for a newer release, and the install of the real file works. Until then the result is `not_published`.
10. **WiFi from the published site.** In an up-to-date Chrome on a computer and on an Android phone, open the published site and connect by `zenit-XXXX.local`, then by the board's address: the browser asks once for local network access; allowed, the app connects and controls the light; answering after more than 5 seconds still connects. Deny the permission in another browser profile: the connection fails with the sentence about allowing it. In Firefox the address field is off with its note.
11. **Memory.** With WiFi connected, a page open and an install in progress, read the stack lines on the USB log (`loop stack`, `network stack`, `heap`) and compare them with the figures below.
12. **Improv during a download.** With the test firmware, start a firmware download from `just update-server`, then send WiFi settings over Improv: the answer comes within 32 seconds, and after the download the board is on its stored network (`status.wifi.ssid` unchanged); a new try is accepted.
13. **A release whose image reports another version.** Serve a manifest that names a version the image was not built with: the board installs it, the image confirms itself, the manifest's version goes on the skip list (`skipped`, no `rolled_back`), and the board does not download it again.

## Limits

| Limit                       | Value                                        |
| --------------------------- | -------------------------------------------- |
| WiFi name                   | 1 to 32 bytes of valid UTF-8, no control character (C0, DEL) |
| WiFi password               | empty, 8 to 63 characters, or 64 hexadecimal digits |
| WebSocket message           | 1,024 bytes (the protocol's line limit)      |
| Update manifest             | 1,024 bytes                                  |
| Firmware size               | 65,536 to 1,769,472 bytes                    |
| Web image                   | 4,097 to 524,288 bytes, 1 to 64 files        |
| Web manifest                | 1,024 bytes                                  |
| Emergency page              | 4,096 bytes                                  |
| Repair wait                 | 1 to 60 minutes, then up to 20 % either way  |
| WebSocket clients           | 1                                            |
| HTTP sockets                | 5                                            |
| Improv frame data           | 255 bytes                                    |
| Scan results                | 16                                           |
| Connection by Improv        | 30 s from the request, answered within 32 s  |
| Download                    | 10 minutes                                   |


## Measurements

On the bare ESP32-C3 SuperMini over USB, with no WiFi network (2026-11-22), with the milestone 4 firmware:

- The firmware is 1,317,871 bytes, 74.5 % of its 1,769,472-byte slot, which leaves 451,601 bytes. The web image of the app, without the installer, is 167,326 bytes of the 524,288-byte `www` partition (milestone 4 firmware with the app inside: 1,485,232 bytes). With [ADR 0006](../adr/0006-firmware-size.md) (the common certificate bundle, the SuperMini's board variant and SHA-256 from mbedTLS) the firmware is 1,248,833 bytes, 70.6 % of the slot, which leaves 520,639 bytes, against 1,318,689 bytes for the same code just before (the release code had grown since the measurement above); the three changes save 50,547, 17,944 and about 1,400 bytes. On the board with home WiFi, that firmware checks the web image at boot (`ok`), keeps the USB console, and an update check against the real site completes over HTTPS with the common bundle (`not_published` before the first release). On a wired unit (2026-11-23, panel power, driven over WiFi with network login on): the board LED blinks during the Improv join and is off otherwise; red, green, blue and white each light alone with no flicker at 30 %, white at 10, 30 and 50 %; `breathing` fades smoothly; the change back to `static` shows the effect-change transition (down to 20 % in 500 ms, then up in 500 ms).
- Web app on the board (2026-11-22, home WiFi, update test firmware and `just update-server` on a computer of the same network): with the image's header erased the board answers `/` with the emergency page and `503`, reports `missing`, finds nothing published on the real site and waits 43 seconds before the next try; from the test server it downloads and installs the image without a restart and serves `/` again with `200`. The served app's main script (130 KB gzipped) loads in about 0.3 seconds from the partition.
- The loop task's lowest free stack is 5,080 bytes of 8,192 after `info`, `settings_get` and `status` (the milestone 2 firmware had 5,044 after every command).
- The network task's lowest free stack is 8,256 bytes of 12,288 after a scan with the radio on. A TLS connection (check, download) and the HTTP server's own task are not measured: they need a network, see the [test plan](#board-test-plan).
- The heap has about 214,000 bytes free with the radio off (largest block 114,676); during a scan its lowest was 148,812 bytes.
- Boot and trial: the firmware boots, and an image the bootloader marks as pending verification confirms itself within a second (otadata state went from new to valid), tested on the second slot with a hand-made otadata.
- Over USB: Improv answers current state, device info (`Zenit`, version, `ESP32-C3`, `zenit-XXXX`), unknown command, bad checksum, invalid network, and scans the networks in range; `update_check` and `update_install` answer `no_network`; `wifi_forget`, `token_regenerate`, `settings_reset` and the board settings work and persist.
