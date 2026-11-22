# 6. Firmware size

Date: 2026-11-22

Status: accepted; amends decision 4 of [ADR 0004](0004-wifi-and-updates.md)

## Context

The firmware was 1,318,689 bytes of its 1,769,472-byte slot. About 85 % of it is the precompiled ESP-IDF and Arduino-ESP32 libraries (the WiFi stack, lwIP, mbedTLS, mDNS, the HTTP server and client, the C library), which a project built with `framework = arduino` cannot configure; Zenit's own code is about 78 KB. A study of the link map found three parts that the project links but does not need, each removable without rebuilding the framework:

- The framework's full certificate bundle: 68,471 bytes of about 150 roots, for a firmware that reads from one site.
- The RMT driver: the board definition uses Arduino's generic ESP32-C3 variant, which declares an addressable RGB LED, so the core's `digitalWrite` links the code that drives it. The SuperMini has a plain LED.
- A hand-written SHA-256 next to the one mbedTLS already links for HTTPS, which runs on the chip's SHA engine.

## Decision

1. **Espressif's common certificate bundle.** The firmware embeds the 43 roots of esp-idf's `cmn_crt_authorities.csv`, made by Espressif's own generator from the esp-idf files of the framework's release, under the symbols of the framework's bundle (`src/crt_bundle.S`). CI makes it again and compares it byte for byte, and a test checks offline that the saved GitHub Pages chain verifies against it ([`certs/README.md`](../../certs/README.md)).
2. **The SuperMini's own board variant,** `nologo_esp32c3_super_mini`, shipped with Arduino-ESP32: the LED on GPIO 8 and no RGB LED. Pins are unchanged; Zenit names its own.
3. **SHA-256 from mbedTLS on the board.** The hash becomes a board and simulator pair: mbedTLS on the board, the portable code in the simulator and the tests, both held to the conformance cases. HMAC-SHA256 stays one implementation in `lib/` on top of it. A failure of the hash engine is reported, and the caller refuses what it was checking.

Rejected:

- **Only the root of GitHub Pages:** 51 KB more saved, but a change of certificate authority by GitHub would stop the updates of every board until a USB install.
- **Building ESP-IDF from source** (Arduino as an ESP-IDF component) to remove logs, IPv6, TLS server code and other options: 150 to 300 KB, at the cost of a new build structure, much longer builds and libraries that differ from the tested precompiled ones. The slot has room enough.
- **Driving WiFi through ESP-IDF instead of Arduino's `WiFi` library:** perhaps 20 to 30 KB, not measured, for a rewrite of tested network code. Kept for a later, measured change.

## Consequences

- The firmware is 70 KB smaller (measured in [the specification](../board/wifi-and-updates-v1.md#measurements)).
- An update server must use a certificate from one of the 43 common roots. GitHub Pages does today; a move outside them is a decision of the project and a new bundle.
- The bundle is pinned to the esp-idf release of the framework: moving the framework to another release regenerates it.
- The firmware notices list the Mozilla CA list under the MPL-2.0.
- The board hashes the web image at every start and each download on the SHA engine.
