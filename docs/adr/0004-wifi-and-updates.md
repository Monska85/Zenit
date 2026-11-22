# 4. WiFi and updates

Date: 2026-11-22

Status: accepted; decision 1 and the slot budget of the consequences amended by [ADR 0005](0005-web-app-partition.md): the app is in its own partition, not in the firmware

## Context

[ADR 0001](0001-architecture.md) fixed two tasks, A/B over-the-air updates with rollback and one command protocol for every transport; [ADR 0003](0003-web-app.md) built the web app and found that an `https://` page cannot open `ws://` to a board on the home network. Milestone 4 adds WiFi, the protocol over it, WiFi setup, and updates. The units go to families who will never type an address or run a command.

## Decision

1. **The board serves the web app.** The built app, gzipped, is embedded in the firmware at build time and served on HTTP port 80 with a strict content security policy, next to the WebSocket on `/ws`. Page and socket share an origin, so there is no mixed content, and the app connects by itself when it finds `/board.json`. The published `https://` site keeps USB control, firmware install and WiFi setup (Web Serial needs a secure context). Rejected: a board with its own certificate (browsers refuse it), a relay server (privacy and cost), setup access point (decided against in the requirements).
2. **WiFi setup is Improv Wi-Fi Serial over USB,** implemented from its public specification in `lib/ZenitImprov`. ESP Web Tools and the Zenit app both speak it. Rejected: an Arduino library (none is standard, the format is a few dozen bytes per frame).
3. **Two tasks, static queues, a snapshot under a mutex.** The network task moves bytes and never touches the light or the settings; the loop task runs every command. One large allocation (a TLS connection) exists at a time, and the HTTP server refuses new connections while it is open.
4. **Only platform components.** `esp_http_server` with WebSocket support, `esp_http_client` with the certificate bundle, `esp_ota_ops`, SNTP, mDNS, all in the Arduino-ESP32 libraries already used. No new library. SHA-256 and HMAC are one small implementation in `lib/` shared by the board, the simulator and the tests. The framework's full certificate bundle is used as it is.
5. **Board settings are a second versioned record,** stored with the light record as one blob (`settings`), so one write saves both and a save is all or nothing, with the WiFi credentials and the token in the board record. Rejected: two keys written one after the other (a failed second write or a power cut leaves half a change, and a compensating write can fail too), and a journal with boot recovery (more states to get wrong than one atomic key).
6. **Network login is off by default,** with a 16-character token made at the first start, readable over USB only, and an HMAC-SHA256 challenge so the token never crosses the network.
7. **Updates come from the project's site:** a small update manifest (`firmware/update.json`, distinct from the ESP Web Tools manifest) with version, size and SHA-256, over HTTPS. The site address is fixed at build time. Modes off, notify and automatic (default), an install window, no downgrade over the network. Rejected: signing the image in version 1 (the owner controls the site, and key management for ten units is more risk than it removes); an update server of our own.
8. **Trial boot and rollback are always on.** The new image confirms itself after a health check (settings read, first output written, protocol started), else the bootloader or the firmware rolls back, and the failed version goes on a one-entry skip list. Compared with a longer record of installs, the simpler rule fits one firmware image.
9. **Test builds only read update manifests from plain HTTP,** from a local test server, through a separate build environment and a compile-time switch. Release builds cannot.

## Consequences

- A family member joins the WiFi with the web app over USB once, then uses the board's own address from a phone. Nothing leaves the home network except the update check to the project's site.
- The flash image grows with the web app; the slot must keep at least 64 KiB free, checked in CI and by the release script. A larger app needs a lower budget for the JavaScript, which the web size check already enforces.
- The board's HTTP page and WebSocket are unencrypted. Network login protects commands, not privacy of the traffic. This is stated in the app.
- Updates trust the site's HTTPS and its host: a compromise of the GitHub account compromises the units. The risk is accepted for ten gifts and recorded here; signing is the next step if the audience grows.
- A repository that is still private has no site: update checks report `not_published` until the site exists.
- A second WebSocket connection is closed with 1013 at its first message on the board and answered 503 by the simulator's bridge, because the HTTP server answers the handshake by itself and calls the firmware for frames only; the board reads the `Origin` header from the raw request.
