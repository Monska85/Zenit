# 1. Firmware architecture, light model and connection

Date: 2026-11-21

Status: proposed

## Context

Zenit is a star projector: one CREE RGBW-1225 LED under a perforated dome, four channels (red, green, blue, white) switched by low-side MOSFET modules from an ESP32-C3 SuperMini, all at 5 V from a USB-C panel socket. The hardware is described in [`docs/reference/hardware.md`](../reference/hardware.md) and the requirements in [`docs/requirements/firmware-v1.md`](../requirements/firmware-v1.md).

Constraints that shape the firmware:

- **Heat.** The base is PLA, which softens at 55 to 60 degrees C. The total LED power must stay below a limit that the thermal test will fix, about 1 to 1.5 W.
- **Pure colors.** The four dies sit side by side, so two dies lit together project stars with colored fringes.
- **One board model, ten units, one firmware,** delivered as Christmas gifts on 2026-12-25, controlled by families from a browser.
- **LEDC on the ESP32-C3** has 6 channels, a 14-bit maximum duty resolution, and a timer clock that gives at most 4,882 Hz at 14 bits.

## Decision

1. **Stack.** C++17 on Arduino-ESP32 3.3.x through PlatformIO `espressif32`, at exact versions verified on the registry when the project is created. One firmware environment, `esp32c3` (ESP32-C3 SuperMini), a `native` environment for the simulator and a `native_test` environment for the tests. Built with `-Os` and without exceptions.
2. **Flash layout** (4 MB), fixed before the first release:

   | Name       | Type | Subtype  | Offset     | Size       |
   | ---------- | ---- | -------- | ---------- | ---------- |
   | `nvs`      | data | nvs      | `0x9000`   | `0x5000`   |
   | `otadata`  | data | ota      | `0xE000`   | `0x2000`   |
   | `app0`     | app  | ota_0    | `0x10000`  | `0x1F0000` |
   | `app1`     | app  | ota_1    | `0x200000` | `0x1F0000` |
   | `coredump` | data | coredump | `0x3F0000` | `0x10000`  |

   Amended before the first release by [ADR 0005](0005-web-app-partition.md): the slots are `0x1B0000` each (`app1` at `0x1C0000`) and a `www` data partition of `0x80000` at `0x370000` holds the web app as one read-only image.

   No file system: settings, WiFi credentials, token and update records live in NVS. The core dump of a crash stays readable over USB.

3. **Pure logic in `lib/`, hardware behind board and simulator pairs.** The light engine (perceptual curve, power limit, fades, effects, timer), the protocol decisions, the network rules and the update decisions are plain C++ in `lib/`, with no Arduino or ESP-IDF calls. Hardware access sits in `src/<module>_board.cpp` and `src/<module>_sim.cpp`, selected at build time.
4. **Two FreeRTOS tasks.** The loop task owns the light engine, the outputs, the settings and every protocol request. The network task owns WiFi, NTP, HTTPS and the WebSocket server, never touches the light or the settings, and exchanges work with the loop task through static fixed-size queues. One large allocation (a TLS connection) at a time.
5. **Light model.** Specified in [`docs/board/light-v1.md`](../board/light-v1.md):
   - one color at a time, among `white`, `red`, `green` and `blue`: the engine never lights two dies together;
   - brightness is a perceptual level (CIE 1931 lightness) turned into a PWM duty, so fades and low levels look even;
   - every output passes through a power limit, a firmware constant (1,000 mW until the thermal test) that scales every channel by the same factor; with one die at a time the limit does not bind at 100 %, but it is enforced on every output;
   - the engine computes the outputs every 10 ms from a monotonic clock, so it is deterministic and testable at any time step.
6. **Effects are classes in one registry.** Each effect is one class in `lib/` that maps the elapsed time and its parameters to a color and a level; one table lists them with their names and parameters. Adding an effect is one file and one table row, plus its specification and conformance cases.
7. **PWM is a firmware constant:** 1 kHz at 14 bits, the maximum resolution of the ESP32-C3 at that frequency. The earlier MicroPython test reported "16 bits" because its API scales a 16-bit value to the hardware resolution. If the first unit shows hum, camera flicker or visible steps, the fallback is 19.5 kHz at 12 bits.
8. **Safe outputs.** The gate pull-downs keep the channels off while the chip boots; the firmware sets every duty to 0 before it attaches the pins. On every start the light fades in to the saved configuration. A crash, a watchdog reset or a brownout restarts the board into the same safe start.
9. **The connection** uses a line framing with CRC-32, `seq` and idempotent retries, strict JSON, `info` handshake, Improv WiFi setup over USB, mDNS name `zenit-XXXX.local`, WebSocket on `/ws`, origin check, optional network login with HMAC-SHA256, A/B OTA with trial boot, rollback and skip list, firmware manifest on the project's GitHub Pages. The protocol is specified in [`docs/protocol/protocol-v1.md`](../protocol/protocol-v1.md). There is no file transfer: Zenit stores no files.
10. **Updates are firmware only.** Modes `off`, `notify` and `automatic` (the default) with an install window. There is no content release.
11. **The web app** is built in `web/`: React, TypeScript, Vite, a static site on GitHub Pages, Web Serial and WebSocket, firmware install with ESP Web Tools.
12. **Simulator.** The firmware sources compiled for the host with the LEDC driver replaced by a recorder. It writes the duty of each channel over time, plays in real time in the terminal, and serves the protocol on a local WebSocket for the web app and its end-to-end tests.
13. **Rotation later.** A future dome motor (NEMA 17 with a TMC2209 over UART) will be its own module next to the light engine. No pin or code is reserved for it now.
14. **Process.** Full rigor from the first release: specifications and conformance cases worked out by hand, native tests, web unit and end-to-end tests, reference screenshots, release-please, CI with path filters. The work is delivered in four milestones: foundation and light engine, protocol over USB with settings and releases, web app, WiFi and OTA.

## Consequences

- The light engine can be tested completely on the host, including fades, effects and the timer, because it depends only on time and settings.
- Without a file system, adding user-defined content later (custom effects as data, for example) needs a layout change and a USB reflash of every unit. The effect registry keeps that need small.
- Changing the partition table after the first release erases the settings of every unit.
- The power limit constant is temporary; the thermal test sets its final value in a later change.
