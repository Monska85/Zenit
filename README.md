# Zenit

Firmware for Zenit, a star projector: one RGBW power LED under a perforated dome projects a starry sky or Christmas shapes on the ceiling. An ESP32-C3 SuperMini drives the four colors through MOSFET modules with a perceptual brightness curve, a power limit, effects, smooth transitions and a switch-off timer. A simulator runs the same code on your computer, without any hardware.

The project is under construction. This version holds the light engine, the command protocol over USB and WiFi, WiFi setup with Improv, a board that serves the web app itself, over-the-air updates with a trial boot and rollback, the simulator, a command line client, the web app, and releases.

## Documentation

| Document                                                             | Content                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------- |
| [`docs/requirements/firmware-v1.md`](docs/requirements/firmware-v1.md) | What the firmware must do and the decisions taken             |
| [`docs/reference/hardware.md`](docs/reference/hardware.md)           | The board, the LED, the MOSFET modules, pins and limits       |
| [`docs/adr/`](docs/adr/)                                             | Architecture decision records                                 |
| [`docs/board/light-v1.md`](docs/board/light-v1.md)                   | The light: curve, power limit, effects, transitions and timer |
| [`docs/board/wifi-and-updates-v1.md`](docs/board/wifi-and-updates-v1.md) | WiFi, Improv setup, the served web app, updates and rollback |
| [`docs/protocol/protocol-v1.md`](docs/protocol/protocol-v1.md)       | The command protocol over USB and WiFi                        |
| [`docs/web/web-app-v1.md`](docs/web/web-app-v1.md)                   | The web app: views, connection, wording, privacy, tests       |
| [`conformance/README.md`](conformance/README.md)                     | Test cases every implementation must pass                     |

## Safety

Never connect the ESP32's own USB port while the panel socket of a unit is powered: on the ESP32-C3 SuperMini the USB 5 V is tied to the 5V pin. To flash a wired unit, disconnect the panel socket first. On USB alone the board runs, but the LED has no power. See [Safety rules](docs/reference/hardware.md#safety-rules).

## Commands

The `justfile` and the `Makefile` have the same commands: `just <name>` or `make <name>` (`just` or `make help` lists them). Builds need [PlatformIO](https://platformio.org/); the simulator needs a host C++17 compiler.

| Command           | What it does                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `just build`      | Build the firmware for the ESP32-C3 SuperMini                                               |
| `just build-update-test http://192.168.1.5:8000/` | Build the update test firmware, which reads updates from a plain `http://` test server. Never released |
| `just update-server --version 1.2.0 --firmware .pio/build/esp32c3/firmware.bin` | Serve a firmware file (or `--web` a web image) and its update manifest for the update test firmware |
| `just upload`     | Flash the firmware (`PORT=/dev/ttyACM0 just upload` to choose the port)                     |
| `just web-image`  | Build the web app and its image for the board's `www` partition                             |
| `just upload-web` | Write the web image to the board over USB                                                   |
| `just monitor`    | Open the serial monitor (115200 baud)                                                       |
| `just flash`      | Flash, then open the serial monitor                                                         |
| `just sim`        | Run the simulator and write `sim-out/trace.csv` and `sim-out/viewer.html`                   |
| `just sim-live`   | Run the simulator in real time and draw the light in the terminal                           |
| `just serve`      | Serve the simulator's command protocol on a local WebSocket (`ws://127.0.0.1:8765`)         |
| `just cli`        | Run the command line client (`just cli --port /dev/ttyACM0 info`)                           |
| `just test`       | Run the native tests and the conformance cases                                              |
| `just tools-test` | Run the Python tool tests                                                                   |
| `just notices`    | Write the third-party notices of the firmware build                                         |
| `just release-assets 1.2.3` | Build the files of a release in `release/`                                        |
| `just format`     | Format the C++ sources                                                                      |
| `just check`      | Check formatting, run every test suite, build the firmware, the simulator and the notices   |
| `just web-install` | Install the web app's dependencies from the lockfile                                       |
| `just web-dev`    | Start the web app with live reload on `http://localhost:5173`                               |
| `just web-test`   | Type check, lint, check the formatting and run the web app's unit and conformance tests     |
| `just web-build`  | Build the web app into `web/dist`                                                           |
| `just web-size`   | Build, then check the JavaScript loaded at start against its 150 KB gzip budget             |
| `just web-e2e`    | Run the end-to-end tests and layout checks against the simulator                            |
| `just web-screenshots` | Compare the reference screenshots, inside the Playwright container (needs Docker)      |
| `just web-check`  | The whole web gate: the five steps above                                                    |
| `just clean`      | Remove build outputs and simulator output                                                   |

### Resource limits

`JOBS` (parallel jobs, default 4) and `NICE` (priority of the heavy steps, default 10) limit the builds and tests: `JOBS=8 NICE=0 just check`, or `make check JOBS=8 NICE=0`.

## Simulator

The simulator runs the light code on a virtual clock and records the duty of every channel every 10 ms. Its options set the stored settings and the events of a run:

```sh
just sim --set effect=color_change --set colors=red,green,blue --duration 120
just sim --set timer_minutes=1 --duration 100
just sim --event 5000:off --event 8000:on --event 12000:brightness=100
just sim-live --set effect=breathing
```

`sim-out/viewer.html` plays the run in a browser with a chart of the four channels. Run `.pio/build/native/program --help` for every option.

### Command protocol

The simulator speaks the [command protocol](docs/protocol/protocol-v1.md) as the board does. `--protocol` reads request lines on standard input and writes reply lines on standard output until the input closes. The clock is virtual and moves only on the line `!advance MS`; with `--live` it follows the real clock. `--transport wifi` makes the input the board's WiFi transport, where `settings_reset` is `usb_only`.

```sh
printf '@ZN 3c250228 {"seq":1,"cmd":"info"}\n!advance 500\n' | .pio/build/native/program --protocol
```

`just serve` runs the simulator behind `tools/ws_bridge.py`, a local WebSocket at `ws://127.0.0.1:8765` that follows the [WebSocket rules](docs/protocol/protocol-v1.md#websocket): one client at a time, an origin check (`just serve --ws-origin https://example.org` adds an origin), the close codes of the specification, and the network login (a failed login closes the connection with 1008). `just serve --app web/dist` serves the built web app on the same port, as a board does, with its security headers and `/board.json`: open `http://127.0.0.1:8765/` and the app connects by itself. It needs the `websockets` package (`pip install -r requirements-ci.txt`).

The simulator has control lines for the network, the update source and the firmware slots (`!net`, `!scan`, `!store-wifi`, `!token`, `!random`, `!version`, `!update ...`, `!firmware ...`, `!restart`), used by the conformance cases and the native tests; see [WiFi and updates](docs/board/wifi-and-updates-v1.md#tests-and-simulator).

### Command line client

`tools/zenit.py` runs a command against a board over USB or against the simulator's WebSocket. It sends `info` first, repeats a request that gets no reply (2 s, 5 tries), and prints the reply as JSON. The exit status is 0 for a successful reply, 1 for an error reply and 2 when nothing could be reached. It needs `pyserial` and `websockets` (`pip install -r requirements-ci.txt`).

```sh
just cli --port /dev/ttyACM0 info
just cli --port /dev/ttyACM0 settings-set brightness=40 effect=breathing
just cli --port /dev/ttyACM0 light off
just cli --ws ws://127.0.0.1:8765 status
just cli --port /dev/ttyACM0 raw '{"cmd":"settings_get"}'
just cli --port /dev/ttyACM0 update-check
just cli --ws ws://zenit-a1b2.local/ws --token <token> status
```

`settings-set` takes `KEY=VALUE` pairs: numbers, `true`, `false` and `null` as such, `colors=red,blue` as a list, anything else as text. Only one program can open the serial port at a time, and the `just monitor` window must be closed first.

## WiFi and updates

A Zenit joins the home WiFi once, over USB, from the web app (the Device page, on the published `https://` site, in Chrome or Edge) or from the Connect to Wi-Fi button of ESP Web Tools: both speak [Improv Wi-Fi Serial](https://www.improv-wifi.com/serial/). The board is then `zenit-XXXX.local` (the last two bytes of its MAC address) and serves the web app itself at `http://zenit-XXXX.local/`, with the protocol on `ws://zenit-XXXX.local/ws`. Network login is off by default; with it on, a client logs in with the 16-character token printed by `settings-get` over USB.

The board checks the project's site for a newer firmware (`firmware/update.json`) every few hours, and installs it by itself inside a time window (settings `update_mode`, `install_start`, `install_end`, `timezone`). The new firmware boots on trial, confirms itself after a health check, and the board goes back to the old one if it does not; a version that failed is skipped. The settings are in the [protocol](docs/protocol/protocol-v1.md#settings_get-settings_set), the rules in [WiFi and updates](docs/board/wifi-and-updates-v1.md). While the repository is private its site does not exist, and a check reports `not_published`. To test an update before that, build the test firmware (`just build-update-test`) and serve a firmware file with `just update-server`.

## Web app

The web app in [`web/`](web/) controls a Zenit from a phone or a laptop: a big on/off button, brightness, the six effects with only the settings each one reads, a sleep timer and the live state, over USB (Web Serial, in Chrome and Edge) or over a WebSocket. Its Device page shows the firmware version against the latest published one and installs or updates the firmware with [ESP Web Tools](https://esphome.github.io/esp-web-tools/). It is a static site that sends nothing anywhere but to the board. The specification is [`docs/web/web-app-v1.md`](docs/web/web-app-v1.md).

To try it without a board, run it against the simulator:

```sh
just serve                 # the simulator on ws://127.0.0.1:8765 (needs the websockets package)
just web-dev               # in a second terminal: the app on http://localhost:5173
```

Open `http://localhost:5173`, type `ws://127.0.0.1:8765` in the address field and press Connect. A browser lets a page on `localhost` reach the simulator; a page loaded over `https://` cannot open an unencrypted WebSocket to a board on the network, so the published site connects over USB and sets WiFi up, and a board on WiFi is used from its own `http://` address, which serves this app. The commands, the test suites (Vitest, Playwright, reference screenshots) and the layout of `web/` are described in [`web/README.md`](web/README.md).

## Project layout

| Path                    | Content                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `lib/ZenitLight/`       | The light engine: curve, power limit, effects, transitions and timer. Plain C++, no hardware    |
| `lib/ZenitProto/`       | The protocol: CRC-32, framing, strict JSON, request checks, settings as JSON, reply cache, WebSocket messages |
| `lib/ZenitNet/`         | WiFi decisions, origin check, login, HMAC-SHA256, board settings and their record, the served app's answers, the web image and its writer |
| `lib/ZenitImprov/`      | Improv Wi-Fi Serial: frame codec and the splitter that tells frames from protocol lines         |
| `lib/ZenitUpdate/`      | Semantic versions, the update manifest, the schedule and window, the update record and boot decisions |
| `src/protocol.cpp`      | The commands, and the dispatch to the light and the settings                                    |
| `src/serial_link.cpp`   | The USB serial transport, with Improv frames (board only)                                       |
| `src/network_*.cpp`     | The network task: WiFi, mDNS, SNTP and the update transfers on the board (`_board`), a stand-in in the simulator (`_sim`) |
| `src/ws_server_board.cpp` | The HTTP and WebSocket server: the web app and the protocol on WiFi                          |
| `src/firmware_*.cpp`, `src/update*.cpp` | The firmware slots (trial boot, rollback, install) and the update flow          |
| `src/improv.cpp`        | Improv's commands over the network API                                                          |
| `src/main.cpp`          | `setup()` and `loop()` of the board                                                             |
| `src/app.cpp`           | The light engine on the loop task, with its settings and outputs                                |
| `src/output_*.cpp`      | The LED outputs: LEDC PWM on the board (`_board`), a recorder in the simulator (`_sim`)         |
| `src/settings*.cpp`     | The settings, in NVS on the board and in memory in the simulator                                |
| `src/platform*.cpp`     | Clock, randomness, log and build identity                                                       |
| `src/sha256_*.cpp`      | SHA-256: mbedTLS on the chip's SHA engine on the board, portable code in the simulator          |
| `src/crt_bundle.S`, `certs/` | The certificate roots the board checks HTTPS servers with ([`certs/README.md`](certs/README.md)) |
| `src/sim_main.cpp`      | Entry point of the simulator                                                                    |
| `test/`                 | Native tests, run on the simulator                                                              |
| `conformance/`          | Test cases worked out by hand from the specifications                                           |
| `tools/`, `scripts/`    | The command line client, the WebSocket bridge, the release, notices and Pages tools, the version rules, the PlatformIO build scripts |
| `web/`                  | The web app: React, TypeScript and Vite, its tests, screenshots and build scripts               |
| `docs/`                 | Requirements, hardware reference, decisions and specifications                                  |

## Releases

[release-please](https://github.com/googleapis/release-please) manages two packages, each with its own release pull request on `main`, its version and its changelog worked out from the commits: the firmware (tags `vX.Y.Z`, `CHANGELOG.md`) and the web app (tags `web-vX.Y.Z`, `web/CHANGELOG.md`). Merging the firmware pull request tags `vX.Y.Z` and creates the GitHub Release, and `.github/workflows/release.yml` then attaches:

- `zenit-esp32c3-factory.bin`: the firmware's flash in one image, to write at address 0 on a blank or old board (`esptool.py write_flash 0x0 zenit-esp32c3-factory.bin`). It erases the settings. The web app is not in it: write the image of a web release (`zenit-web-X.Y.Z.bin`) at 0x370000 as well, or let the board fetch the app by itself once it is on WiFi.
- `zenit-esp32c3-firmware.bin`: the application alone, for an over-the-air update.
- `zenit-esp32c3-bootloader.bin`, `zenit-esp32c3-partitions.bin` and `zenit-esp32c3-boot_app0.bin`: the other parts of the factory image, which the web app's installer writes at 0x0, 0x8000 and 0xE000 with the firmware at 0x10000, so an update keeps the settings.
- `zenit-esp32c3-protocol.txt`: the protocol version the firmware speaks, which the site checks against the web app it pairs with.
- `THIRD_PARTY_NOTICES.txt` and `SHA256SUMS`.

Once the repository is public, each file carries a signed build provenance attestation, made by the release workflow with `actions/attest-build-provenance` (a private repository needs a paid plan for it, so the step runs only when the repository is public). Check a download with `gh attestation verify zenit-esp32c3-factory.bin --repo Monska85/Zenit`: it proves the file was built by that workflow from the tagged commit.

A web release attaches `zenit-web-X.Y.Z.tar.gz` (the built app, with its third-party notices), `zenit-web-X.Y.Z.bin` (the image of the board's `www` partition) and their `SHA256SUMS`. After either release the workflow assembles one GitHub Pages site from the latest of each (`tools/pages_site.py`): the web app at the root, the web image and its `update.json` under `web/`, and the latest firmware under `firmware/` (the ESP Web Tools manifest and the parts the Device page installs, the web image included, which keep the settings, and `update.json`). Boards on WiFi read both `update.json` files to update the firmware and the web app on their own. GitHub Pages on a private repository needs a paid plan, so the deploy job runs only when the repository is public; turn Pages on (Settings, Pages, source GitHub Actions) at that point.

`just release-assets 1.2.3` builds the firmware files in `release/`. The repository needs the setting "Allow GitHub Actions to create and approve pull requests". A release pull request opened with the default token does not start the other workflows; a `RELEASE_PLEASE_TOKEN` secret (a fine-grained token with Contents, Pull requests and Issues read and write) makes the workflow use that token instead.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`: `actionlint` checks the workflows, `check` runs `make check` (tests, the firmware and simulator builds, tool tests and the notices), checks that the firmware leaves 64 KiB of its slot free and attaches a simulator trace of every effect, and `web` runs the web gate (types, lint, formatting, unit and conformance tests, the build with its size budget, the end-to-end tests against the simulator and the reference screenshots). On a pull request that changes only documentation (`docs/` and Markdown files), `check` and `web` are skipped and report success.

## Contributing

Changes reach `main` through pull requests, merged by squashing: the commit on `main` takes the pull request title, a single-line [Conventional Commit](https://www.conventionalcommits.org/) (`<type>[(scope)][!]: <description>`). The rules for code and documentation are in [`AGENTS.md`](AGENTS.md).

## License

Zenit is free software under the GNU General Public License, version 3 or (at your option) any later version ([`LICENSE`](LICENSE)), with the additional permission in [`LICENSE-EXCEPTION`](LICENSE-EXCEPTION) for the binary-only libraries Espressif distributes. Third-party licenses are described in [`LICENSES/README.md`](LICENSES/README.md).
