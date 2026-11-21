# Command protocol, version 1

Status: **proposed**. Why it works this way is recorded in [ADR 0001](../adr/0001-architecture.md). The light it controls is specified in [Light](../board/light-v1.md).

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
- One client at a time: a second connection is refused until the first one closes.
- **Origin check.** The board accepts a connection whose `Origin` is missing (command line clients), the project's site (the site address the firmware was built with), `localhost`, a `.local` name or a private network address. Any other origin is closed with status 1008 after the handshake. The simulator accepts a missing origin, `http://localhost` and `http://127.0.0.1` with any port, the project's site, and the origins added with `--ws-origin`.
- With `network_login` on, a WiFi client [authenticates](#authentication) first.

The board remembers the last reply of each transport separately, and forgets the one of the WiFi transport when a WiFi connection opens or closes.

## Lines

Every protocol message, in both directions, is one line:

```text
@ZN <crc> <json>
```

- `@ZN` followed by one space, at the very start of the line.
- `<crc>` is the CRC-32 of the `<json>` bytes as sent (the zlib, PNG and Ethernet CRC: polynomial `0x04C11DB7` reflected, initial value and final XOR `0xFFFFFFFF`), as 8 lowercase hexadecimal digits, followed by one space. In Python it is `zlib.crc32(data)`.
- `<json>` is one JSON object in valid UTF-8, with no newline inside, following strict JSON: no comments, no single quotes, no unquoted keys, no control characters inside strings, no unpaired escaped surrogate, no U+0000, nothing after the object, nesting at most 4 levels.
- The line ends with `\n`. A `\r` just before the `\n` is ignored.

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

The light, WiFi, time and update state. No fields.

```text
> {"seq":2,"cmd":"status"}
< {"seq":2,"ok":true,"light":{"on":true,"effect":"static","color":"white","lightness":60.0,"power_scale":100,"timer":{"minutes":30,"remaining":1754}},"wifi":{"state":"connected","ip":"192.168.1.42","rssi":-58,"power":"8.5","power_reduced":false,"hostname":"zenit-a1b2","ssid":"Example Home WiFi"},"time":{"known":false},"update":{"state":"idle","progress":0,"last_check":1200,"last_result":"ok","last_detail":null,"firmware":null,"last_install":null}}
```

| Field                     | Meaning                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `light.on`                | `false` after off from the app or the end of the timer, until the light is turned on or the board restarts; `true` otherwise.     |
| `light.effect`            | The `effect` setting.                                                                                                             |
| `light.color`             | The color lit now, or `null` when the light is off.                                                                               |
| `light.lightness`         | The lightness `L` sent to the curve now, from 0 to 100, with one decimal.                                                         |
| `light.power_scale`       | The percentage the [power limit](../board/light-v1.md#power-limit) leaves of the duties now, from 1 to 100.                       |
| `light.timer`             | `null` with no timer, otherwise `minutes` (the setting) and `remaining`, the whole seconds until the fade-out starts, 0 after it. |
| `wifi`, `time`, `update`  | Specified with the WiFi and updates milestone. The hostname is `zenit-XXXX`.                                                      |

### `settings_get`, `settings_set`

The board's settings, stored in NVS. `settings_get` has no fields; its reply holds `settings`, an object with every setting.

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

Board settings, specified with the WiFi and updates milestone:

| Setting           | Type    | Default             | Values                                                                        |
| ----------------- | ------- | ------------------- | ----------------------------------------------------------------------------- |
| `wifi_power`      | string  | `auto`              | `auto`, `8.5`, `11`, `13`, `15`, `17`, `18.5`, `19.5`.                         |
| `update_mode`     | string  | `automatic`         | `off`, `notify`, `automatic`.                                                 |
| `update_firmware` | boolean | `true`              | `true` or `false`.                                                            |
| `check_hours`     | integer | `6`                 | 1 to 168.                                                                     |
| `install_start`   | integer | `0`                 | 0 to 1,439, minutes after midnight.                                           |
| `install_end`     | integer | `0`                 | 0 to 1,439. Equal to `install_start`: the whole day.                          |
| `timezone`        | string  | `UTC0`              | A POSIX TZ string, 1 to 64 printable ASCII characters.                        |
| `time_sync_hours` | integer | `6`                 | 1 to 168.                                                                     |
| `ntp_server`      | string  | `pool.ntp.org`      | A host name or IPv4 address, 1 to 64 characters: letters, digits, `.`, `-`.   |
| `network_login`   | boolean | `false`             | Whether WiFi clients must authenticate.                                       |
| `token`           | string  | made at first start | Read only: 16 characters from `a-z` and `0-9`. USB only in `settings_get`.    |

`settings_set` has one optional field per setting except `token`, and at least one of them. The board checks every field before changing anything: a value of the wrong type, out of range or unknown, `null` included, is `bad_request`. The light settings are stored as one record, written in one step, so a save is all or nothing even when the power fails during it. If the settings cannot be saved, the reply is `storage_error` and no setting has changed. On success the reply holds `settings`, with every setting after the change. Nothing is written when no setting differs.

The board saves at once. A client sends a setting when the user has chosen it (a slider when it is released, for example), not while the user is still moving it, so the settings memory is not written many times a second.

Light settings apply at once, with the [transitions](../board/light-v1.md#transitions) of the light. A change of `timer_minutes` while the light is on restarts the countdown.

```text
> {"seq":9,"cmd":"settings_set","effect":"breathing","period_seconds":12}
< {"seq":9,"ok":true,"settings":{"brightness":60,"effect":"breathing","color":"white",...}}
```

(`...` stands for the other settings. On the link each example is a full `@ZN <crc> <json>` line.)

### `light`

Turns the light on or off, without saving. One field, `on`: `true` or `false`.

- `on: false` fades the light out in 1 second; it stays off until `light` with `on: true` or a restart.
- `on: true` fades the light in to the current settings in 1 second and starts the timer again. When the light is already on, nothing changes.

The reply holds `light`, as in `status`.

### `settings_reset`

Puts every setting back to its default, forgets the WiFi network and makes a new token. No fields. USB only. The reply holds `settings` after the reset. The light fades to the default configuration.

### `wifi_forget`

Erases the stored WiFi network and disconnects. No fields. USB only. `busy` when the network task cannot take the request now.

### `token_regenerate`

Makes a new token and closes the WiFi client's connection. No fields. USB only. The reply holds `token`.

### `auth_challenge`, `auth`

[Authentication](#authentication) for a WiFi client. `auth_challenge` has no fields; its reply holds `nonce`, 32 lowercase hexadecimal digits. `auth` has one field, `hmac`, 64 lowercase hexadecimal digits.

### `update_check`, `update_install`

Firmware updates from the project's manifest: `update_check` starts a check in the background; `update_install` has `target` (`firmware`, the only value) and an optional `force` (installs a version on the skip list). Their rules, the update states and the update errors are specified with the WiFi and updates milestone.

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

Every error leaves the settings as they were.

## Limits

| Limit                                    | Value       |
| ---------------------------------------- | ----------- |
| Line read by the board, newline excluded | 1,024 bytes |
| JSON nesting in a request                | 4 levels    |

Lines sent by the board can be longer; clients accept lines up to 4,096 bytes.

## Versions

### Protocol version

Version 1 grows only by addition: new commands, new optional request fields, new reply fields, new error codes, new colors, effects and color sets. Removing or changing the meaning of anything makes protocol 2.

### Firmware version

`info.firmware` is set when the firmware is built, from the git tag:

- A build of a commit tagged `vX.Y.Z`, with no local changes, reports `X.Y.Z`.
- Any other build reports `<last tag>-dev.<commits since the tag>+g<commit>`, with `.dirty` at the end when there are local changes. Without a tag, the last tag counts as `0.0.0`. Only tags of the form `vX.Y.Z` count.
- A build made without git reports `0.0.0-unknown`.

## Security

- Every size, count and nesting depth has a limit, checked before memory is used for it.
- Over USB and the simulator's WebSocket there is no authentication.
- Over WiFi, only the origins listed under [WebSocket](#websocket) connect. With `network_login` off (the default), anyone on the network can send every command except those reserved for USB. With it on, a WiFi client authenticates first.

### Authentication

With `network_login` on, a WiFi client authenticates once per connection:

1. The client sends `auth_challenge`. The board answers with `nonce`: 16 random bytes from the hardware generator, as 32 lowercase hexadecimal digits. A new `auth_challenge` replaces the previous nonce.
2. The client sends `auth` with `hmac`: HMAC-SHA256 with the token's 16 ASCII bytes as the key and the nonce's 32 ASCII characters as the message, as 64 lowercase hexadecimal digits.
3. When it matches, the connection is authenticated until it closes. Otherwise the reply is `unauthorized`. A nonce serves one `auth` only. After 3 failed `auth` on one connection, the board closes it.

Before authenticating, a WiFi client can send `info`, `auth_challenge` and `auth`; every other command is `unauthorized`. The token never crosses the network, but `ws://` is not encrypted.

## Conformance

The cases in `conformance/protocol/` describe exchanges of requests and expected replies, run against the simulator. Each change to the protocol comes with new cases, worked out by hand from this document.
