# Third-party licenses

The firmware links Arduino-ESP32 and ESP-IDF with their components (WiFi, lwIP, the HTTP server and client, mDNS and mbedTLS among them), including the binary-only libraries Espressif distributes (PHY, Bluetooth, coexistence, WiFi); [`LICENSE-EXCEPTION`](../LICENSE-EXCEPTION) gives the permission to combine Zenit with them. ArduinoJson (MIT license) is compiled into the firmware and the simulator.

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
| `lwip.LICENSE`               | `COPYING` of espressif/esp-lwip at the commit of ESP-IDF v5.5.5 (fd432e4ee2cf)                          |
| `cJSON.LICENSE`              | `LICENSE` of DaveGamble/cJSON at the commit of ESP-IDF v5.5.5 (b2890c8d76bb)                            |
| `http_parser.LICENSE`        | `components/http_parser/LICENSE.txt`, ESP-IDF v5.5.5                                                    |
| `wpa_supplicant.LICENSE`     | `components/wpa_supplicant/COPYING` and the license terms of its `README`, ESP-IDF v5.5.5               |
| `protobuf-c.LICENSE`         | `LICENSE` of protobuf-c/protobuf-c at the commit of ESP-IDF v5.5.5 (abc67a11c6db)                       |

## Web app

The build of the web app (`just web-build`) writes `THIRD_PARTY_NOTICES.txt` at the root of the app (`web/scripts/notices.ts`). It lists every package the bundler links, read by `rollup-plugin-license` with its license and license text, the packages ESP Web Tools carries inside its own bundle (read from the installed tree), and two fixed entries. The license files are in [`web/`](web/) in this folder:

| File                                     | From                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `shadcn-ui.LICENSE.md`                   | the MIT license of shadcn/ui, whose component pattern `web/src/ui/components` follows             |
| `esptool-legacy-flasher-stub.LICENSE`    | the GPL-2.0-or-later license of the flasher stubs that esptool-js bundles and ESP Web Tools loads into the board |
| `lit.LICENSE`, `react-remove-scroll-bar.LICENSE` | the license texts of two bundled packages that ship none, for the versions named in `MISSING_TEXTS` |

The build fails on a bundled package whose license is not in the allowed list (permissive licenses and those compatible with GPL-3.0-or-later) and on one with no license text; a package with no text gets its file here and an entry in `MISSING_TEXTS`, for that version only. The published site also carries `LICENSE.txt` and `LICENSE-EXCEPTION.txt`.

## Updating

When the framework moves to another ESP-IDF or Arduino-ESP32 release, or a managed component to another version, the build of the notices stops with the name and both versions. Take each text in `firmware/` again from the new version, as the table says, update `pins` in `firmware.json` and the table above. When the build links an archive that no section names, add it to the section of the component it comes from, or a new section with its license and text. A new PlatformIO library goes into `libraries` in `firmware.json` with its license and the names of its license files.

A new third-party dependency of the firmware or the web app gets its notice in the same change. Its license must be one that GPL-3.0-or-later can include.
