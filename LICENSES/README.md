# Third-party licenses

The firmware links Arduino-ESP32 and ESP-IDF with their components, including the binary-only libraries Espressif distributes (PHY, Bluetooth, coexistence); [`LICENSE-EXCEPTION`](../LICENSE-EXCEPTION) gives the permission to combine Zenit with them. ArduinoJson (MIT license) is compiled into the firmware and the simulator.

## Firmware

`tools/firmware_notices.py` writes `THIRD_PARTY_NOTICES.txt` for a release, and `just check` builds it too. It reads the link map (`.pio/build/esp32c3/firmware.map`), so it lists what the firmware really links, and it:

- names every linked archive with a section of [`firmware.json`](firmware.json), with its license, its source and the files of its license text. It fails if no section names an archive, so a new dependency cannot be shipped without its notice.
- reads the versions from the build: ESP-IDF and the managed components from `versions.txt` of the framework's library package, Arduino-ESP32 from that package's `package.json`, the compiler from its own `package.json`, and each PlatformIO library from its `library.json` or `library.properties`.
- fails when the build uses another ESP-IDF, Arduino-ESP32 or component version than `pins` in `firmware.json`: the texts in `firmware/` were taken from those versions.
- takes the text of ArduinoJson from the library itself and those of newlib and of the GCC runtime from the compiler package (`share/licenses/`), so they always match the build.
- lists a library that has no archive of its own (ArduinoJson, headers only) when a project library that is linked depends on it in its `library.json`.

The texts in `firmware/`, taken on 2026-11-22:

| File                         | From                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `arduino-esp32.LICENSE.md`   | `LICENSE.md` of espressif/arduino-esp32 at tag 3.3.12                                                   |
| `esp-idf.LICENSE`            | `LICENSE` of espressif/esp-idf at tag v5.5.5; the binary libraries and esp_diagnostics carry the same text |
| `FreeRTOS-Kernel.LICENSE.md` | `components/freertos/FreeRTOS-Kernel/LICENSE.md`, ESP-IDF v5.5.5                                        |
| `mbedtls.LICENSE`            | `LICENSE` of espressif/mbedtls at the commit of ESP-IDF v5.5.5 (9d669eadb195)                           |
| `tlsf.LICENSE`               | the BSD-3-Clause text (SPDX) with the copyright line of `tlsf.c`, espressif/tlsf at the commit of ESP-IDF v5.5.5 (2867f6883a12) |

## Updating

When the framework moves to another ESP-IDF or Arduino-ESP32 release, or a managed component to another version, the build of the notices stops with the name and both versions. Take each text in `firmware/` again from the new version, as the table says, update `pins` in `firmware.json` and the table above. When the build links an archive that no section names, add it to the section of the component it comes from, or a new section with its license and text. A new PlatformIO library goes into `libraries` in `firmware.json` with its license and the names of its license files.

A new third-party dependency of the firmware or the web app gets its notice in the same change. Its license must be one that GPL-3.0-or-later can include.
