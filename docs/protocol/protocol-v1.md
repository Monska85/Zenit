# Command protocol, version 1

Status: **accepted**. Why it works this way is recorded in [ADR 0001](../adr/0001-architecture.md), and how it is implemented in [ADR 0002](../adr/0002-protocol-and-releases.md). The light it controls is specified in [Light](../board/light-v1.md).

The first firmware that speaks it (milestone 2) implements `info`, `status`, `settings_get`, `settings_set`, `light` and `settings_reset` over USB serial and over the simulator's WebSocket. The WiFi and updates milestone (4) adds WiFi, authentication and updates, marked "from the WiFi and updates milestone" below and specified in [WiFi and updates](../board/wifi-and-updates-v1.md); a firmware from before that milestone answers those commands `unknown_command`, and clients ignore the reply parts it leaves out.

This document specifies how a client (the web app, the command line tool, a test) talks to a Zenit board: reading what the board is, changing its settings, turning the light on and off, setting up WiFi and installing firmware updates. Zenit stores no files, so there is no file transfer.

## Transports

### USB serial

The board reads requests from its USB serial port and writes replies to it. The same port carries the board's log lines (`zenit: ...`) and [Improv Wi-Fi](https://www.improv-wifi.com/serial/) frames. Protocol lines start with their own marker, so a client tells them apart without any switch or mode.

The link can lose or change bytes, so every protocol line carries a checksum and the client repeats a request when its reply is missing or damaged (see [Retries](#retries)). The board sets a receive buffer of 4,096 bytes before it opens the port. A client sends `info` first and waits for its reply before any other request, and reads with a buffer of at least 8,192 bytes (in a browser, Web Serial's `bufferSize`).

Only one program can open the serial port at a time.

Remember the [power rule](../reference/hardware.md#safety-rules): a unit whose panel socket is powered must never be connected over USB. On USB alone the board answers every command, but the LED has no power.

### WebSocket

A board connected to WiFi serves the protocol on `ws://<board>/ws`, port 80, and the simulator on `ws://127.0.0.1:<port>`:

- Every WebSocket text message carries exactly one protocol line, without the final newline.
- The [line limit](#limits) counts the whole message after reassembly. A longer message closes the connection with status 1009, a binary message with 1003, a text message containing a newline with 1008, and one that is not valid UTF-8 with 1007.
- One client at a time: a second connection is refused until the first one closes. The simulator's bridge answers HTTP 503; the board accepts the handshake and closes the connection with status 1013 (try later) at its first message, because its HTTP server answers the handshake by itself. A connection that sends nothing is closed after 10 seconds.
- **Origin check.** The board accepts a connection whose `Origin` is missing (command line clients), the project's site (the site address the firmware was built with), `localhost`, a `.local` name or a private network address. Any other origin is closed with status 1008 at its first message. The simulator accepts a missing origin, `http://localhost` and `http://127.0.0.1` with any port, the project's site, and the origins added with `--ws-origin`.
- **The simulator's WebSocket is the WiFi transport.** The commands reserved for USB answer `usb_only` there, as on a board on WiFi. `just serve` starts it (see [Simulator](../../README.md#simulator)).
- With `network_login` on, a WiFi client [authenticates](#authentication) first.

The board remembers the last reply of each transport separately, and forgets the one of the WiFi transport when a WiFi connection opens or closes.

## Lines

Every protocol message, in both directions, is one line:

```text
@ZN <crc> <json>
```

- `@ZN` followed by one space, at the very start of the line.
- `<crc>` is the CRC-32 of the `<json>` bytes as sent (the zlib, PNG and Ethernet CRC: polynomial `0x04C11DB7` reflected, initial value and final XOR `0xFFFFFFFF`), as 8 lowercase hexadecimal digits, followed by one space. In Python it is `zlib.crc32(data)`.
- `<json>` is one JSON object in valid UTF-8, with no newline inside, following strict JSON: no comments, no single quotes, no unquoted keys, no control characters inside strings, no unpaired escaped surrogate, no U+0000, nothing after the object, nesting at most 4 levels, no newline or carriage return anywhere (between tokens only a space or a tab is whitespace), and no key named twice in one object, at any level (keys are compared after their escapes are decoded).
- The line ends with `\n`. One `\r` just before the `\n` is ignored; any other `\r` is part of the JSON, which has none, so `...}\r\r\n` is `bad_frame`.

For example, the `info` request with sequence number 1:

```text
@ZN 3c250228 {"seq":1,"cmd":"info"}
```

Every line the board sends is valid UTF-8 and written in one piece, so it never mixes with a log line. Text the board quotes from a request has every byte that is not part of a well-formed UTF-8 sequence replaced by U+FFFD, and control characters escaped.

The board ignores, without replying, every line that does not start with `@ZN `. It answers `bad_frame`, without `seq`, when a line starts with `@ZN ` but is longer than the line limit, has a malformed or wrong CRC, or holds JSON that breaks the rules above. A client that gets `bad_frame` repeats its last request at once. A client throws away every line it receives with a bad CRC.

A line from the board with no `seq` and an `event` field is an event. Version 1 defines no events; clients ignore events they do not know.

## Requests and replies

A request is a JSON object with `seq` (an integer from 0 to 4,294,967,295, new for each request), `cmd` (the command) and the command's own fields. A field the command does not define is `bad_request`, not ignored. A request without a valid `seq` or `cmd` is answered `bad_request` without `seq`.

The board answers every well-formed request with exactly one reply, in order: `seq`, `ok`, and on failure `error` (an [error code](#errors)) and `message` (for people; clients do not parse it). On success the reply holds the command's own fields. Clients ignore reply fields they do not know.

Every whole number in a reply is from -(2^53 - 1) to 2^53 - 1 (9,007,199,254,740,991), what a JavaScript number holds exactly; clients refuse a reply with a larger one. A field the tables below give as a range is refused outside it, as a reply that does not have its fields' types is.

### Retries

The client waits for the reply with a timeout (2 seconds) and then sends the same request again, with the same `seq`, up to 5 times in all. The board remembers its last reply on each transport with the `seq` and the CRC of the request it answered; the same `seq` with the same CRC gets that reply again without running the command twice. The same `seq` with another CRC is a new request. The board forgets the remembered replies when it restarts; `info.boot_id` lets a client notice a restart. A client keeps one request in flight and accepts only the reply whose `seq` matches it.

## Commands

### `info`

What the board is and what it supports. No fields.

```text
> {"seq":1,"cmd":"info"}
< {"seq":1,"ok":true,"protocol":1,"firmware":"1.0.0","board":"esp32c3","boot_id":2864434397,"colors":["white","red","green","blue"],"effects":["static","color_change","breathing","twinkle","fall_asleep","christmas"],"color_sets":["christmas","ice"],"power_limit_mw":1000,"memory":{"free":182340,"largest":110580},"nvs":{"used":96,"free":408},"limits":{"line":1024}}
```

| Field            | Meaning                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `protocol`       | The protocol version, `1`. A client reads it before anything else.                                          |
| `firmware`       | The firmware version, see [Firmware version](#firmware-version).                                            |
| `board`          | `esp32c3`, or `simulator`.                                                                                  |
| `boot_id`        | A random number chosen at every start. A change means the board restarted.                                 |
| `colors`         | The colors the board can light.                                                                             |
| `effects`        | The effects the board knows, in the order a client shows them.                                              |
| `color_sets`     | The preset lists of the `christmas` effect.                                                                 |
| `power_limit_mw` | The power limit of the light, in mW.                                                                        |
| `memory`         | `free` bytes and the `largest` allocatable block, for diagnosis; `0` for both in the simulator.             |
| `nvs`            | `used` and `free` entries of the settings memory, for diagnosis; `0` for both in the simulator.             |
| `limits`         | `line`: the longest line the board reads.                                                                   |

A client offers only the colors, effects and color sets the board lists, so later firmware can add them.

### `status`

The light, and from the WiFi and updates milestone the WiFi, time and update state. No fields. A firmware from before that milestone replies with `light` only.

```text
> {"seq":2,"cmd":"status"}
< {"seq":2,"ok":true,"light":{"on":true,"effect":"static","color":"white","lightness":60.0,"power_scale":100,"timer":{"minutes":30,"remaining":1754}}}
```

| Field                     | Meaning                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `light.on`                | `false` after off from the app or the end of the timer, until the light is turned on or the board restarts; `true` otherwise.     |
| `light.effect`            | The `effect` setting.                                                                                                             |
| `light.color`             | The color lit now, or `null` when no channel has a duty above 0. It follows the output, not `light.on`: `null` while the light is off and at a level below the first duty step, and the fading color during the fade-out after off, while `on` is already `false`. |
| `light.lightness`         | The lightness `L` sent to the curve now, from 0 to 100, always written with one decimal (`60.0`).                                 |
| `light.power_scale`       | The percentage the [power limit](../board/light-v1.md#power-limit) leaves of the duties now, from 1 to 100.                       |
| `light.timer`             | `null` with no timer, otherwise `minutes` (the setting, 1 to 360) and `remaining`, the whole seconds until the fade-out starts, from 0 (after it) to `minutes` times 60. |
| `wifi`                    | From the WiFi and updates milestone: `state` (`not_configured`, `connecting`, `connected`, `not_found`, `wrong_password`, `no_address`), `ssid` (the stored network, or `null`), `rssi` (dBm, a whole number from -128 to 127, since a very strong signal can read slightly above 0; or `null` when not connected), `ip` (or `null`) and `hostname` (`zenit-XXXX`). |
| `time`                    | `synced`, `epoch` (Unix seconds, 0 to 2^53 - 1, or `null` until synced) and `local_minute` (minutes after midnight in `timezone`, 0 to 1,439, or `null`). |
| `update`                  | `mode`, `state`, `available`, `last_check`, `last_result`, `progress`, `trial`, `skipped`, `rolled_back`, `target` and `web` (`state`, `version`, `available`, `last_result`, `retry_in`), as [WiFi and updates](../board/wifi-and-updates-v1.md#status) defines them. |

### `settings_get`, `settings_set`

The board's settings, stored in NVS. `settings_get` has no fields; its reply holds `settings`, an object with every setting. A firmware from before the WiFi and updates milestone has the light settings only.

Light settings, specified in [Light](../board/light-v1.md):

| Setting            | Type    | Default                             | Values                                                          |
| ------------------ | ------- | ----------------------------------- | --------------------------------------------------------------- |
| `brightness`       | integer | `60`                                | 1 to 100.                                                       |
| `effect`           | string  | `static`                            | One of `info.effects`.                                          |
| `color`            | string  | `white`                             | One of `info.colors`.                                           |
| `colors`           | array   | `["red","green","blue","white"]`    | 2 to 4 of `info.colors`, no repeats.                            |
| `color_set`        | string  | `christmas`                         | One of `info.color_sets`.                                       |
| `hold_seconds`     | integer | `30`                                | 5 to 600.                                                       |
| `period_seconds`   | integer | `8`                                 | 4 to 20.                                                        |
| `floor`            | integer | `20`                                | 5 to 80.                                                        |
| `twinkle_strength` | integer | `20`                                | 5 to 50.                                                        |
| `timer_minutes`    | integer | `0`                                 | 0 (no timer), or 1 to 360.                                      |

Board settings, from the WiFi and updates milestone, which adds them to `settings_get`, `settings_set` and `settings_reset` (a firmware from before it has no field for them, so one is `bad_request`):

| Setting           | Type    | Default             | Values                                                                        |
| ----------------- | ------- | ------------------- | ----------------------------------------------------------------------------- |
| `wifi_power`      | string  | `auto`              | `auto`, `8.5`, `11`, `13`, `15`, `17`, `18.5`, `19.5`.                         |
| `update_mode`     | string  | `automatic`         | `off`, `notify`, `automatic`.                                                 |
| `update_firmware` | boolean | `true`              | `true` or `false`.                                                            |
| `update_web`      | boolean | `true`              | `true` or `false`.                                                            |
| `check_hours`     | integer | `6`                 | 1 to 168.                                                                     |
| `install_start`   | integer | `0`                 | 0 to 1,439, minutes after midnight.                                           |
| `install_end`     | integer | `0`                 | 0 to 1,439. Equal to `install_start`: the whole day.                          |
| `timezone`        | string  | `UTC0`              | A POSIX TZ string, 1 to 64 printable ASCII characters other than space.       |
| `time_sync_hours` | integer | `6`                 | 1 to 168.                                                                     |
| `ntp_server`      | string  | `pool.ntp.org`      | A host name or IPv4 address, 1 to 64 characters: letters, digits, `.`, `-`.   |
| `network_login`   | boolean | `false`             | Whether WiFi clients must authenticate.                                       |
| `token`           | string  | made at first start | Read only: 16 characters from `a-z` and `0-9`. USB only in `settings_get`.    |

`settings_set` has one optional field per setting except `token`, and at least one of them. The board checks every field before changing anything: a value of the wrong type, out of range or unknown, `null` included, is `bad_request`. The light settings and the board settings are stored together, in one write, so a save is all or nothing even when the power fails during it. If the settings cannot be saved, the reply is `storage_error` and no setting has changed. On success the reply holds `settings`, with every setting after the change. Nothing is written when no setting differs.

The board saves at once. A client sends a setting when the user has chosen it (a slider when it is released, for example), not while the user is still moving it, so the settings memory is not written many times a second.

Light settings apply at once, with the [transitions](../board/light-v1.md#transitions) of the light. A change of `timer_minutes` while the light is on restarts the countdown. Board settings apply at once too: a new `wifi_power`, `timezone`, `ntp_server` or `time_sync_hours` reaches the network task; turning `network_login` on ends the WiFi client's login at once and makes the board close its connection after the reply, so it logs in when it connects again.

```text
> {"seq":9,"cmd":"settings_set","effect":"breathing","period_seconds":12}
< {"seq":9,"ok":true,"settings":{"brightness":60,"effect":"breathing","color":"white",...}}
```

(`...` stands for the other settings. On the link each example is a full `@ZN <crc> <json>` line.)

### `light`

Turns the light on or off, without saving. One field, `on`: `true` or `false`.

- `on: false` fades the light out in 1 second; it stays off until `light` with `on: true` or a restart.
- `on: true` fades the light in to the current settings in 1 second and starts the timer again. When the light is already on, nothing changes, except during the timer's fade-out, which comes back up and restarts the timer (see [Light](../board/light-v1.md#timer)).

The reply holds `light`, as in `status`.

### `settings_reset`

Puts every setting back to its default, forgets the WiFi network (a download that is running stops with `unreachable`) and makes a new token, which ends the WiFi client's login at once and closes its connection after the reply. No fields. USB only: over WiFi the reply is `usb_only`. The reply holds `settings` after the reset. The light fades to the default configuration. A firmware from before the WiFi and updates milestone puts the light settings back and has no network or token to forget. If the settings cannot be saved the reply is `storage_error` and nothing changes.

### `wifi_forget`

From the WiFi and updates milestone. Erases the stored WiFi network and disconnects; a download that is running stops with `unreachable`, so the radio leaves the network at once. No fields; the reply has none. USB only: `usb_only` over WiFi. `storage_error` when the settings memory fails (nothing changes). The network task always takes the change, so `busy` does not happen.

### `token_regenerate`

From the WiFi and updates milestone. Makes a new token, ends the WiFi client's login at once and closes its connection after the reply. No fields. USB only: `usb_only` over WiFi. The reply holds `token`; `storage_error` when it cannot be saved (the old token stays).

### `auth_challenge`, `auth`

From the WiFi and updates milestone. [Authentication](#authentication) for a WiFi client. `auth_challenge` has no fields; its reply holds `nonce`, 32 lowercase hexadecimal digits. `auth` has one field, `hmac`, 64 lowercase hexadecimal digits; a field that is not 64 lowercase hexadecimal digits is `bad_request`, and its reply has no fields on success. They work over WiFi whether `network_login` is on or not. Over USB there is no authentication, and both answer `bad_request`.

### `update_check`, `update_install`

From the WiFi and updates milestone. Firmware and web app updates from the project's manifests: `update_check` starts a check in the background; `update_install` has `target` (`firmware` or `web`) and, for the firmware only, an optional `force` (installs a version on the skip list). `update_check` is `updates_off` when `update_mode` is `off`, or when `update_firmware` and `update_web` are both `false`; `update_install` is `updates_off` when `update_mode` is `off` or the setting of its target is `false`. Both are `no_network` when the board is not connected.

- `update_check` starts a check in the background: the firmware manifest, then the web manifest, each when its updates are on. Its reply holds `update`, the same object as `status.update`, with `state` `checking` (or the state the board is in when a check or install is already running; a second check does not start). The client follows the result with `status`.
- `update_install` starts the download of the version the last check found for its target, and its reply holds `update` with `state` `downloading` and `target`. `nothing_to_install` when no check has found a newer version (or the board is on trial, or, for the firmware, the last check was not successful); `busy` when a check or an install is running; the firmware version on the skip list is installed only with `force: true`. A version that is not newer than the running one (or the web image in place) is never installed. `target` must be `firmware` or `web`, and `force` a boolean given with `firmware` only; anything else is `bad_request`.
- When a firmware download is verified, the board restarts. The connection drops and the client reconnects. When a web image is installed, the board closes the WebSocket client with code `1012` and the app reloads the page.

## Errors

| Code                 | Meaning                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `bad_frame`          | The line is too long, its CRC is malformed or wrong, or its JSON is broken. No `seq`.         |
| `bad_request`        | A field is missing, unknown, of the wrong type or out of range.                               |
| `unknown_command`    | `cmd` names a command this firmware does not know.                                            |
| `storage_error`      | The settings memory failed.                                                                   |
| `unauthorized`       | Over WiFi with network login on: the client has not authenticated, or `auth` failed.          |
| `usb_only`           | The command works over USB only.                                                              |
| `busy`               | The board cannot take the request now; nothing changed, and the client may repeat it.         |
| `updates_off`        | Updates are off for what the command asks.                                                    |
| `no_network`         | The board is not connected to WiFi.                                                           |
| `nothing_to_install` | The last check found nothing to install.                                                      |

`unauthorized`, `no_network`, `updates_off` and `nothing_to_install` are produced from the WiFi and updates milestone. `busy` too: before it, a reply that does not fit the reply buffer would be answered `busy`, which no command does. Every error leaves the settings as they were.

## Limits

| Limit                                    | Value       |
| ---------------------------------------- | ----------- |
| Line read by the board, newline excluded | 1,024 bytes |
| JSON nesting in a request                | 4 levels    |

Lines sent by the board can be longer; clients accept lines up to 4,096 bytes.

## Versions

### Protocol version

Version 1 grows only by addition: new commands, new optional request fields, new reply fields, new error codes, new colors, effects and color sets. Removing or changing the meaning of anything makes protocol 2.

Open words: the words that name a state, a result or a choice (`status.wifi.state`, `status.update.mode`, `status.update.state`, `status.update.last_result`, and the settings `wifi_power` and `update_mode`) may get new values in a later firmware. A client accepts any text there, shows an unknown word plainly, and applies a rule that depends on a word (an address only while `connected`, a percentage only while `downloading`) only to the words it knows. What the specification closes stays strict: ranges, whole numbers, versions of the form `X.Y.Z`, the token, the nonce, the host name and the null rules above.

### Firmware version

`info.firmware` is set when the firmware is built, from the git tag:

- A build of a commit tagged `vX.Y.Z`, with no local changes, reports `X.Y.Z`.
- Any other build reports `<last tag>-dev.<commits since the tag>+g<commit>`, with `.dirty` at the end when there are local changes. Without a tag, the last tag counts as `0.0.0`. Only tags of the form `vX.Y.Z` count.
- A build made without git reports `0.0.0-unknown`.

## Security

- Every size, count and nesting depth has a limit, checked before memory is used for it.
- Over USB there is no authentication. The simulator's WebSocket is the WiFi transport: it checks the origin and the network login as a board on WiFi does.
- Over WiFi, only the origins listed under [WebSocket](#websocket) connect. With `network_login` off (the default), anyone on the network can send every command except those reserved for USB. With it on, a WiFi client authenticates first.

### Authentication

With `network_login` on, a WiFi client authenticates once per connection:

1. The client sends `auth_challenge`. The board answers with `nonce`: 16 random bytes from the hardware generator, as 32 lowercase hexadecimal digits. A new `auth_challenge` replaces the previous nonce.
2. The client sends `auth` with `hmac`: HMAC-SHA256 with the token's 16 ASCII bytes as the key and the nonce's 32 ASCII characters as the message, as 64 lowercase hexadecimal digits.
3. A client that has not authenticated 10 seconds after its connection opened is closed (status 1008), so a silent client cannot hold the single connection. When it matches, the connection is authenticated until it closes, or until a new token, a reset or turning `network_login` on ends the login: from that moment, while `network_login` is on, every request the client sends, a request resent with the `seq` of an earlier one included, is `unauthorized` until it logs in again, and the board closes the connection meanwhile. A reset turns the login off, so after it the client is only closed. Otherwise the reply is `unauthorized`. A nonce serves one `auth` only. After 3 failed `auth` on one connection, the board closes it.

Before authenticating, a WiFi client can send `info`, `auth_challenge` and `auth`; every other command is `unauthorized`. The token never crosses the network, but `ws://` is not encrypted.

## Conformance

The cases in `conformance/protocol/` describe exchanges of requests and expected replies, run against the protocol core with a virtual clock. Each change to the protocol comes with new cases, worked out by hand from this document. Their format is in [`conformance/README.md`](../../conformance/README.md).

## Measurements

The figures below are those of milestone 2; the figures of the WiFi and updates firmware are in [WiFi and updates](../board/wifi-and-updates-v1.md#measurements).

On an ESP32-C3 SuperMini with the milestone 2 firmware (2026-11-22), after every command, a damaged line and a line over the limit had been sent several times, with the longest settings reply:

- The firmware is 355,760 bytes, 17.5 % of its 2,031,616-byte slot (the layout before [ADR 0005](../adr/0005-web-app-partition.md); the slot is now 1,769,472 bytes).
- The loop task's lowest free stack is 5,044 bytes of 8,192 (3,148 used).
- The heap has 277,848 bytes free, with a largest block of 139,252 bytes; the settings memory has 123 entries in use and 507 free.
- The replies are short: `info` about 390 bytes, a `settings` reply at most 270, `status` about 175. The reply buffer holds 1,536.

The stack figure comes from `uxTaskGetStackHighWaterMark`, which the firmware logs (`zenit: loop stack: N bytes free at the lowest`) each time the lowest value falls after a request.
