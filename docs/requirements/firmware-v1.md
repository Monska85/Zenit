# Firmware requirements, version 1

Status: **draft**, collected on 2026-11-21. The hardware facts are in [`docs/reference/hardware.md`](../reference/hardware.md).

## Product

Zenit is a star projector, a Christmas gift for about 10 children, due on 2026-12-25. A perforated dome (the starry sky of a date and place, or Christmas shapes) sits on a printed base and is lit from below by one RGBW LED. At most 10 units exist, all running the same firmware. The firmware does not detect which dome is mounted.

## Hardware summary

ESP32-C3 SuperMini, one CREE RGBW-1225 LED driven by four low-side MOSFET modules with series resistors, powered at 5 V from a USB-C panel socket. Channels on GPIO 3 (red), 4 (green), 5 (blue) and 10 (white), active high. Details, values and limits in [`docs/reference/hardware.md`](../reference/hardware.md).

## Constraints

- **Heat.** The total LED power never exceeds a limit, 1,000 mW, with any combination of channels. The thermal test set it; the limit is one constant.
- **Pure colors.** Effects prefer red, green, blue or white alone, because mixed colors project fringed stars.
- **USB and panel power are never connected together.** On USB alone the board runs and can be configured, but the LED stays off.
- **WiFi.** The SuperMini antenna is weak: the transmit power is reduced.
- **PWM.** Frequency and resolution are free as long as no hum or flicker is perceived; 1 kHz is verified on all four channels; the hardware gives 14 bits at that frequency (ADR 0001).

## Behavior

1. **First start, never configured:** white at a default brightness (a constant). No timer.
2. **Later starts:** the last saved configuration, read from non-volatile memory.
3. **Control:** a web app on GitHub Pages connects to the board and lets the user:
   - choose between white and the light effects;
   - set the brightness;
   - set or clear the switch-off timer.
4. **Timer:** optional, its duration chosen in the app. It starts again from the beginning at every power-on. When it ends, the light switches off with a gradual fade.
5. **Effects:** the list is decided later. Adding an effect must be simple. Examples discussed: slow breathing, color change.

## Connection and web app (decided 2026-11-21)

- The board connection: the command protocol over USB serial and over a WebSocket on WiFi, WiFi setup with Improv over USB, mDNS name, network login, A/B OTA with rollback and a firmware manifest on GitHub Pages.
- The web app is built in this repository (`web/`): a static site on GitHub Pages, Web Serial and WebSocket, firmware install with ESP Web Tools.
- The board making its own WiFi network for setup, proposed earlier in the project plan, is not part of this design.

## Process (decided 2026-11-21)

- Full rigor from the first release: specifications and ADRs first, simulator, native tests, conformance cases, web unit and end-to-end tests against the simulator, reference screenshots, release-please, full CI.
- Everything in the repository is in English.

## Decided with the user (2026-11-21)

1. **Default brightness** of the white on first start: 60 %.
2. **Power limit:** 1.0 W, kept after the thermal test (closed base, about 23 K/W on the heat sink). The firmware keeps the sum of each channel's duty times its full-scale power (red 0.61 W, green, blue and white 0.87 W) at or below the limit, scaling every channel by the same factor so the color stays the same.
3. **Effects:** static white (the default), static red, green and blue, and a color change that fades the current color down to a floor (not to zero), switches color and fades up. The light shows both starry skies and Christmas shapes. More effects are proposed below. Each effect is one C++ class in `lib/`, registered in one table.
4. **Timer:** set in the app, from 1 minute to 6 hours, with a 30 s fade-out at the end.
5. **Off is not saved:** off from the app, or the end of the timer, keeps the light off until the next power cycle; power-on always lights the saved configuration.
6. **Settings in NVS only,** no file system.
7. **Repository and license:** GitHub, GPL-3.0-or-later with the Espressif exception.

8. **Effect list of version 1:** static (white by default, or red, green, blue), color change, breathing, twinkle, fall asleep (brightness decreasing over the timer), Christmas (color change with preset color sets: red, green and white; blue and white). Only pure colors, one die at a time. Candle is not included.
9. **Smooth changes:** brightness, color and effect changes fade in about 0.5 s; a color change fades down to the floor, switches and fades up; power-on fades in over about 1 s; off from the app fades out in about 1 s; only the end of the timer uses 30 s.
10. **Board LED (GPIO 8):** always off, except a blink during WiFi setup, so no blue light leaks from the base at night.
11. **PWM:** a firmware constant, not a setting: 1 kHz at 14 bits (the ESP32-C3's maximum at that frequency) with a perceptual brightness curve. Changed in the firmware if hum, flicker or steps show up on the first unit; the fallback is about 19.5 kHz at 12 bits.
12. **Partition table** (4 MB): `nvs` 0x9000 size 0x5000, `otadata` 0xE000 size 0x2000, `app0` 0x10000 size 0x1B0000, `app1` 0x1C0000 size 0x1B0000, `www` 0x370000 size 0x80000 (the web app, [ADR 0005](../adr/0005-web-app-partition.md)), `coredump` 0x3F0000 size 0x10000.

## Decided with the user (2026-11-28)

1. **Effects reviewed on a preview:** color change and Christmas fade each color to dark before the switch and rise from dark, and no longer read the floor; breathing drifts a little in length and depth; twinkle wanders smoothly at an uneven pace with an occasional deeper dip. This replaces the dip to the floor of decisions 3 and 9 above.
2. **New effects:** shooting star (a sky at 45 % with a flash every 10 to 60 seconds), guided breathing (a pacer with the 4-7-8 or box pattern, a new setting), jingle (pulses in the rhythm of the Jingle Bells chorus, each note in the next color of a palette) and hop (a new color of a palette every 0.7 seconds).
3. **New palettes:** aurora (green, blue), sunset (red, white) and all (red, green, blue, white).
4. **At most 3 light changes a second** in every effect, for photosensitive safety. The formulas are in [Light](../board/light-v1.md#effects).
5. **No dome rotation:** the rotating dome upgrade is dropped, and no motor module is planned.
6. **Favorites:** up to 6 named looks (an effect, its colors or palette, its settings and the brightness) stored on the board, so every phone sees the same list, with two ready-made ones (Starry night, Christmas) that come back after a reset. Applying one is one tap and turns the light on. One favorite may be marked "Turn on with this": Zenit then shows it at power-on and whenever the light is turned on; without a mark, decision 5 holds. Rules in [Light](../board/light-v1.md#favorites) and the [protocol](../protocol/protocol-v1.md#favorites).
