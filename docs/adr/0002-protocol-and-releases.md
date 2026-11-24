# 2. Protocol implementation and releases

Date: 2026-11-22

Status: accepted

## Context

[ADR 0001](0001-architecture.md) fixed the shape of the command protocol, specified in [`docs/protocol/protocol-v1.md`](../protocol/protocol-v1.md). Milestone 2 implements it for USB serial and for the simulator, adds a command line client, and sets up releases, so that a first board can be flashed from a GitHub Release and controlled from a computer before the web app exists.

The constraints that shape this decision:

- The link can lose or change bytes, and the USB port also carries log lines, so a request must be checkable and repeatable.
- The loop task has 8 KiB of stack, and the board has no spare RAM for a second copy of a reply.
- The simulator and the tests must run the code the board runs, and the conformance cases must not depend on it.
- A release must carry what a person needs to install it and the licenses the firmware owes.

## Decision

1. **The protocol decisions are plain C++ in `lib/ZenitProto/`.** CRC-32, line framing, the strict JSON check, the checks of every request field, the settings as JSON, the line reader, the quoting of request text and the reply cache have no Arduino calls, so the tests and the simulator run them unchanged. `src/protocol.cpp` is only the dispatch to `app::` and `settings::`.
2. **ArduinoJson 7.4.3 reads and writes the JSON, after a strict check of our own.** ArduinoJson accepts comments, single quotes and unquoted keys, which the protocol forbids, so `check_strict_object` scans the bytes first (UTF-8, escapes, surrogates, U+0000, nesting, newlines and carriage returns, keys named twice) and only then is the request parsed. No JSON parser of our own.
3. **One line, one reply, written in one piece.** A reply is built in a static buffer with the room for the frame head left in front of the JSON, so the frame is made in place and written with one call and one flush. Log lines and replies therefore never mix. A line longer than the limit is consumed to its newline and answered `bad_frame` only when it starts with the marker; every other line is ignored.
4. **Two reply caches, one per transport,** each holding the last framed reply with the `seq` and the CRC of its request. A repeated request is answered from the cache and never runs twice. Errors with a `seq` are remembered; `bad_frame` and `bad_request` without `seq` are not.
5. **Transports are an enum, `usb` and `wifi`.** The board has `usb` only in this milestone. The simulator's `--transport wifi` makes standard input act as the WiFi transport, which is how the WebSocket bridge exercises `usb_only` and the rule that a connection opening or closing forgets the WiFi reply.
6. **Replies reflect the request.** `status` and `light` run one extra light tick at the time of the request, so a change made a moment ago shows at once instead of at the next 10 ms tick. The tick is idempotent for the same time.
7. **The simulator speaks the protocol on standard input and output** (`--protocol`): in virtual time, which moves only on the line `!advance MS`, or in real time with `--live`. Two control lines, `!wifi-open` and `!wifi-close`, tell the WiFi transport about a connection; the simulator acknowledges the close with `!wifi-closed`, written after every reply to that connection. The WiFi transport keeps every `\r`, as a WebSocket message has no line ending. A control line that cannot be carried out (`!advance` in live mode, a bad number, an unknown line) is reported on standard error. Log lines go to standard output as on the board.
8. **`tools/ws_bridge.py` serves it on a local WebSocket** with the `websockets` library: it starts the simulator, passes text messages as lines, drops messages that start with `!` (the simulator's own control lines), forwards only protocol lines, waits for the close acknowledgement before it serves the next client so no late reply reaches it, and applies the specification's rules (one client with HTTP 503 for a second, origin check closing with 1008, close codes 1009, 1003, 1008 and 1007). The origin check closes after the handshake, as the board does.
9. **`tools/zenit.py` is the client** (pyserial, websockets): the `info` handshake first, a random start for `seq`, a timeout of 2 s and 5 tries, a repeat at once after `bad_frame`, replies of other `seq` and lines with a bad checksum thrown away. It leaves the USB control lines alone on open, because clearing one of them first restarts the ESP32-C3.
10. **Conformance cases for the protocol** are JSON exchanges run against the protocol core with a virtual clock. Their expected replies are typed by hand from the specification; the checksums of raw lines come from `zlib`, an implementation independent of the firmware.
11. **Releases come from release-please** (`googleapis/release-please-action`, pinned by commit), one package `.` of type `simple`, tags `vX.Y.Z`, minor bumps before 1.0, changelog sections named as the Keep a Changelog types. The web app joins in its own milestone. A merged release pull request creates the tag and the GitHub Release; `release.yml` then checks `main`, builds the tag with `ZENIT_VERSION` set to the release, and attaches `zenit-esp32c3-factory.bin`, `zenit-esp32c3-firmware.bin`, `THIRD_PARTY_NOTICES.txt` and `SHA256SUMS`, with a build provenance attestation (`actions/attest-build-provenance`, in the publishing job only, and only once the repository is public, since a private repository needs a paid plan for it).
12. **The factory image is merged in Python** (`tools/release_assets.py`): bootloader at 0x0, partition table at 0x8000, `boot_app0` at 0xE000 and the application at 0x10000, `0xFF` between. It is byte for byte what `esptool merge_bin --flash_size keep` writes, checked once with the toolchain's esptool, and needs no tool at release time. The tool refuses an application that does not fit its slot or does not carry the release version.
13. **Third-party notices follow the link map.** `tools/firmware_notices.py` reads `firmware.map`, names every linked archive from `LICENSES/firmware.json`, takes the versions from the build, and fails on an archive no section names or on an ESP-IDF, Arduino-ESP32 or component version other than the one the license texts in `LICENSES/firmware/` were taken from. `just check` builds the notices, so a new dependency without a notice fails locally and in CI. ArduinoJson (MIT) is header only and is listed through the `dependencies` of `lib/ZenitProto`.

## Consequences

- A board answers the protocol over USB with 3.1 KiB of its loop stack in use at most (5,044 bytes free of 8,192 measured), and about 6 KiB of static RAM for the reply and the two caches.
- The simulator, the bridge and the client are tested against each other, so the web app of the next milestone has a protocol endpoint to develop against and a CLI to set up its end-to-end tests.
- A new protocol field or command needs its check in `lib/ZenitProto`, its specification text and its conformance cases in the same change.
- Opening the board's serial port from a program must not clear DTR or RTS before the other, or the board restarts. The web app's Web Serial code has the same duty.
- Releases need the repository setting "Allow GitHub Actions to create and approve pull requests". A release pull request opened with the default token does not start CI, so release-please acts with a `RELEASE_PLEASE_TOKEN` secret of the `release` environment, which only `main` can use.
- release-please inserts each new release above the `## [Unreleased]` heading of `CHANGELOG.md`, so that heading stays at the bottom and empty; the changelog is written from the commits.
