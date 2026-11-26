# 3. Web app

Date: 2026-11-22

Status: accepted; the consequence on mixed content amended 2026-11-26 (Chrome's Local Network Access)

## Context

[ADR 0001](0001-architecture.md) decided that the web app is built in this repository, as a static site with Web Serial, WebSocket and ESP Web Tools, and [ADR 0002](0002-protocol-and-releases.md) delivered a protocol, a simulator with a WebSocket bridge and a command line client. Milestone 3 builds the app. Ten units go to families at Christmas 2026, so the person holding the phone is not technical, and nobody will read a manual.

The constraints that shape this decision:

- The client must follow the protocol exactly as `tools/zenit.py` does: framing, CRC, strict reply JSON, reply validation, retries.
- Browsers differ from the Python client: `JSON.parse` accepts duplicate keys and hides whether a number was written `1` or `1.0`; Web Serial has its own port rules; an `https://` page cannot open `ws://` to a LAN host, except in Chromium browsers from release 147 after Chrome's Local Network Access prompt.
- The ESP32-C3's USB serial port restarts the chip when DTR and RTS are driven in the wrong order.
- The site is static, on GitHub Pages, and sends nothing anywhere else.
- Firmware and web app are released separately, and one site holds the latest of each.

## Decision

1. **Stack.** React 19, TypeScript (strict), Vite, Tailwind CSS 4, components in the style of shadcn/ui on Radix primitives (slider, alert dialog) copied into `web/src/ui/components/`, lucide icons, ESP Web Tools for installs. Vitest in Node, Playwright with Chromium, ESLint (typescript-eslint, react-hooks), Prettier. npm with a committed lockfile, exact versions at least five days old, `ignore-scripts=true`.
2. **Protocol client in plain TypeScript, no framework.** `web/src/protocol/` holds the CRC-32, a strict JSON reader of our own, framing, the reply schema, the client and two transports behind one line-oriented interface. The strict reader exists because `JSON.parse` cannot reject a repeated key or tell `1.0` from `1`; floats are a distinct type in its output, so integer fields stay strict as in Python.
3. **The client mirrors `tools/zenit.py` rule by rule** (documented in [the specification](../web/web-app-v1.md#client-rules)), and the protocol conformance cases run in Vitest through the client's framing and parsing, so the two clients and the firmware agree on the same hand-worked cases.
4. **Web Serial leaves the control lines alone.** The transport opens the port at 115,200 baud with an 8,192-byte buffer, never calls `setSignals`, and is tested with a fake port that fails the test if it does.
5. **One screen for the light.** Power, brightness, effect cards, only the settings the selected effect reads, and the sleep timer, in a single column that works from 360 px wide. A Device view holds firmware and device facts; a Connect screen and a Privacy page complete it. Views are hash routes, with no router library.
6. **Settings are sent on commit,** never while dragging, matching the protocol's rule that the board saves at once. Status is polled once per second while the page is visible.
7. **Only what the board reports is shown.** Effects, colors and color sets come from `info`, so later firmware adds them without an app change; an unknown effect gets a plain card. WiFi, update and token parts appear when the board reports them, which in this milestone it does not.
8. **Firmware install with ESP Web Tools, loaded on demand,** from a manifest on the same site, after a dialog that makes the user confirm the panel power socket is unplugged. The app closes its own serial connection first. The installer writes the bootloader, partition table, boot_app0 and firmware at their own offsets (the manifest offers a full erase for a clean install), so an update keeps the settings, which a factory image written at address 0 would erase with its 0xFF padding. The installation closes the app's USB connection first, within bounded waits; a port that cannot be released stops it with a message to unplug and replug the cable.
9. **Privacy by construction.** No outside request of any kind, enforced by a content security policy and checked by an end-to-end test that fails on any request outside the site and the board. Local storage holds the theme and the last board address only.
10. **Hosting.** One GitHub Pages site, deployed by the release workflow: the latest web app at the root, the latest firmware (ESP Web Tools manifest and the firmware parts) under `firmware/`. A private repository needs a paid plan for Pages, so the deploy step runs only when the repository is public; the owner turns Pages on at that point.
11. **Releases.** release-please manages a second package `web` (`release-type: node`, component `web`, tags `web-vX.Y.Z`), with separate pull requests from the firmware package, which excludes `web/`. A web release attaches `zenit-web-X.Y.Z.tar.gz`. `tools/pages_site.py` assembles the site from the latest web archive and the latest firmware assets and writes the manifest.
12. **Tests.** Unit and conformance tests in Vitest; end-to-end and layout checks in Playwright on the host against the built app and the simulator through `tools/ws_bridge.py`; reference screenshots inside the official Playwright container so text renders the same on every machine; a size budget on the initial JavaScript. `just check` stays the firmware gate; `just web-check` is the web gate; CI runs both behind the `changes` filter.
13. **Notices.** The build writes `THIRD_PARTY_NOTICES.txt` from the bundled packages, and from the installed tree of ESP Web Tools, which is published already bundled. A package with a license GPL-3.0-or-later cannot include, or with no license text, fails the build.

## Consequences

- A family member can control a unit with a phone or laptop without knowing a protocol term; the cost is a UI of our own for each effect parameter, kept in step with `docs/board/light-v1.md` by hand and by the limits tests.
- The client code duplicates the Python client's rules. The conformance cases and the shared reply table keep them equal; a change to a reply field changes both.
- From the published HTTPS site, Chromium browsers from release 147 reach a board on the home network by its `.local` name or private address after Chrome asks for local network access (amended 2026-11-26). Firefox, Safari and older Chromium releases block the unencrypted WebSocket, so there the Connect screen says so up front and turns the address field off. USB works in the browsers with Web Serial (Chrome and Edge), the board's own `http://` page works over WiFi in every browser, and the simulator works from `localhost`. The WiFi milestone has the board serve this app over HTTP at `http://zenit-XXXX.local/`, where the app connects over WiFi.
- Installing from the web app keeps the settings unless the user chooses the full erase, which resets them. The factory image stays a release file for a blank board and for manual flashing.
- Web Serial exists in Chrome and Edge only (and Chrome on Android), so a family on a phone with another browser can use WiFi only.
- Release tooling now has two packages; the Pages job depends on both release assets, and so a web-only or a firmware-only release rebuilds the whole site.
