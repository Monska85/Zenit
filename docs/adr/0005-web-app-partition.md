# 5. The web app in its own partition

Date: 2026-11-22

Status: accepted

## Context

[ADR 0004](0004-wifi-and-updates.md) made the board serve the web app over HTTP, so a phone on the home network uses it without mixed content. It embedded the app in the firmware image, which ties the two release cycles together: a web release reaches a board only with the next firmware release, and each firmware slot carries its own copy of the app. The firmware and the web app are already separate release-please components. No release exists yet, so the flash layout can still change without erasing any unit's settings.

## Decision

1. **A `www` data partition holds one web image.** The firmware slots shrink from 0x1F0000 to 0x1B0000 each and a 512 KiB partition takes the space freed. NVS, OTA data and the core dump keep their offsets and sizes.
2. **The web image is a read-only package, not a file system.** A header with a magic value, the web version, the protocol versions the app speaks and the SHA-256 of the body, then a file index and the gzipped files. The board serves the files straight from flash, as it does today from the firmware. "No file system" in [ADR 0001](0001-architecture.md) still holds.
3. **One partition, written header last.** An install erases the header first, writes the body, checks the SHA-256 of the whole download against the manifest, then writes the header. A power cut, a stopped download or a bad file leaves no header, so the board knows the app is missing and never serves half an image.
4. **The firmware knows the state of its web app** at every boot and after every install: `ok`, `missing` (no valid image) or `incompatible` (the image does not speak the firmware's protocol). The board checks the header and the SHA-256 of the body at boot.
5. **The firmware keeps a small emergency page** (a few KB) that it serves instead of the app when the app is not `ok`. The page says the app is being installed and reloads by itself, or, when updates are off, how to install it over USB.
6. **A missing or incompatible app is repaired by itself,** with retries on a growing wait (backoff), outside the install window and in `notify` mode too, whenever the board is connected and web updates are on.
7. **Web updates are automatic like firmware updates:** their own manifest (`web/update.json`), their own setting (`update_web`), the same modes, window and checks. No downgrade over the network. A new web image is never rolled back by the board: a broken release is fixed by a newer one.
8. **Compatibility is declared by the web image.** It states the lowest and highest protocol versions it speaks. The board installs only an image that speaks its own protocol. A web release must keep speaking the protocol of the latest firmware release, and the release tool refuses one that does not.
9. **The USB install writes both.** The ESP Web Tools manifest flashes the firmware and the latest web image at the `www` offset.

Rejected:

- **Keep the app in the firmware:** it couples the releases, and every slot keeps a copy.
- **Two web partitions (A/B):** every failure of a web install leaves the firmware, the settings and USB untouched, and the board repairs the app by itself. A second copy only shortens that wait, at the cost of half the room for the app.
- **LittleFS or SPIFFS:** a file system with more code, wear and partial-write states, for files that change only as a whole.
- **Downloading to memory first:** the image is larger than the free heap.

## Consequences

- A web release reaches every board within one check, without a firmware release and without a restart.
- A firmware build no longer needs the web app, and its slot has 1,769,472 bytes instead of 2,031,616.
- While a web install runs, and until a failed one is repaired, a page that is already open keeps working, but loading the app shows the emergency page.
- A board with updates `off` and no valid image shows the emergency page until the app is installed over USB.
- The release process has an order: a web release that speaks a new protocol version is published before the firmware that needs it.
- [ADR 0004](0004-wifi-and-updates.md) decision 1 (the app embedded in the firmware) and the slot budget in its consequences are replaced by this ADR; serving the app from the board, on one origin with the WebSocket, stays. The site address, the transport, the modes and the window apply to both updates. The specification is [WiFi and updates](../board/wifi-and-updates-v1.md#the-served-web-app).
