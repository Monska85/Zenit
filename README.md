# Zenit

Firmware for Zenit, a star projector: one RGBW power LED under a perforated dome projects a starry sky or Christmas shapes on the ceiling. An ESP32-C3 SuperMini drives the four colors through MOSFET modules with a perceptual brightness curve, a power limit, effects, smooth transitions and a switch-off timer. A simulator runs the same code on your computer, without any hardware.

The project is under construction. This version holds the light engine, the command protocol over USB, the simulator, a command line client, and releases; the web app, WiFi and over-the-air updates follow.

## Documentation

| Document                                                             | Content                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------- |
| [`docs/requirements/firmware-v1.md`](docs/requirements/firmware-v1.md) | What the firmware must do and the decisions taken             |
| [`docs/reference/hardware.md`](docs/reference/hardware.md)           | The board, the LED, the MOSFET modules, pins and limits       |
| [`docs/adr/`](docs/adr/)                                             | Architecture decision records                                 |
| [`docs/board/light-v1.md`](docs/board/light-v1.md)                   | The light: curve, power limit, effects, transitions and timer |
| [`docs/protocol/protocol-v1.md`](docs/protocol/protocol-v1.md)       | The command protocol over USB and WiFi                        |
| [`conformance/README.md`](conformance/README.md)                     | Test cases every implementation must pass                     |

## Safety

Never connect the ESP32's own USB port while the panel socket of a unit is powered: on the ESP32-C3 SuperMini the USB 5 V is tied to the 5V pin. To flash a wired unit, disconnect the panel socket first. On USB alone the board runs, but the LED has no power. See [Safety rules](docs/reference/hardware.md#safety-rules).

## Commands

The `justfile` and the `Makefile` have the same commands: `just <name>` or `make <name>` (`just` or `make help` lists them). Builds need [PlatformIO](https://platformio.org/); the simulator needs a host C++17 compiler.

| Command           | What it does                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `just build`      | Build the firmware for the ESP32-C3 SuperMini                                               |
| `just upload`     | Flash the firmware (`PORT=/dev/ttyACM0 just upload` to choose the port)                     |
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

`just serve` runs the simulator behind `tools/ws_bridge.py`, a local WebSocket at `ws://127.0.0.1:8765` that follows the [WebSocket rules](docs/protocol/protocol-v1.md#websocket): one client at a time, an origin check (`just serve --ws-origin https://example.org` adds an origin), and the close codes of the specification. It needs the `websockets` package (`pip install -r requirements-ci.txt`).

### Command line client

`tools/zenit.py` runs a command against a board over USB or against the simulator's WebSocket. It sends `info` first, repeats a request that gets no reply (2 s, 5 tries), and prints the reply as JSON. The exit status is 0 for a successful reply, 1 for an error reply and 2 when nothing could be reached. It needs `pyserial` and `websockets` (`pip install -r requirements-ci.txt`).

```sh
just cli --port /dev/ttyACM0 info
just cli --port /dev/ttyACM0 settings-set brightness=40 effect=breathing
just cli --port /dev/ttyACM0 light off
just cli --ws ws://127.0.0.1:8765 status
just cli --port /dev/ttyACM0 raw '{"cmd":"settings_get"}'
```

`settings-set` takes `KEY=VALUE` pairs: numbers, `true`, `false` and `null` as such, `colors=red,blue` as a list, anything else as text. Only one program can open the serial port at a time, and the `just monitor` window must be closed first.

## Project layout

| Path                    | Content                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `lib/ZenitLight/`       | The light engine: curve, power limit, effects, transitions and timer. Plain C++, no hardware    |
| `lib/ZenitProto/`       | The protocol: CRC-32, framing, strict JSON, request checks, settings as JSON, reply cache       |
| `src/protocol.cpp`      | The commands, and the dispatch to the light and the settings                                    |
| `src/serial_link.cpp`   | The USB serial transport (board only)                                                           |
| `src/main.cpp`          | `setup()` and `loop()` of the board                                                             |
| `src/app.cpp`           | The light engine on the loop task, with its settings and outputs                                |
| `src/output_*.cpp`      | The LED outputs: LEDC PWM on the board (`_board`), a recorder in the simulator (`_sim`)         |
| `src/settings*.cpp`     | The settings, in NVS on the board and in memory in the simulator                                |
| `src/platform*.cpp`     | Clock, randomness, log and build identity                                                       |
| `src/sim_main.cpp`      | Entry point of the simulator                                                                    |
| `test/`                 | Native tests, run on the simulator                                                              |
| `conformance/`          | Test cases worked out by hand from the specifications                                           |
| `tools/`, `scripts/`    | The command line client, the WebSocket bridge, the release and notices tools, the version rules, the PlatformIO build scripts |
| `docs/`                 | Requirements, hardware reference, decisions and specifications                                  |

## Releases

[release-please](https://github.com/googleapis/release-please) keeps a release pull request open on `main`, with the version and the changelog worked out from the commits. Merging it tags `vX.Y.Z` and creates the GitHub Release, and `.github/workflows/release.yml` then attaches:

- `zenit-esp32c3-factory.bin`: the whole flash in one image, to write at address 0 on a blank or old board (`esptool.py write_flash 0x0 zenit-esp32c3-factory.bin`). It erases the settings.
- `zenit-esp32c3-firmware.bin`: the application alone, for an over-the-air update.
- `THIRD_PARTY_NOTICES.txt` and `SHA256SUMS`.

Once the repository is public, each file carries a signed build provenance attestation, made by the release workflow with `actions/attest-build-provenance` (a private repository needs a paid plan for it, so the step runs only when the repository is public). Check a download with `gh attestation verify zenit-esp32c3-factory.bin --repo Monska85/Zenit`: it proves the file was built by that workflow from the tagged commit.

`just release-assets 1.2.3` builds the same files in `release/`. The repository needs the setting "Allow GitHub Actions to create and approve pull requests". A release pull request opened with the default token does not start the other workflows; a `RELEASE_PLEASE_TOKEN` secret (a fine-grained token with Contents, Pull requests and Issues read and write) makes the workflow use that token instead.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`: `actionlint` checks the workflows, and `check` runs `make check` (tests, builds, tool tests and the notices), checks that the firmware leaves 64 KiB of its slot free and attaches a simulator trace of every effect. On a pull request that changes only documentation (`docs/` and Markdown files), `check` is skipped and reports success.

## Contributing

Changes reach `main` through pull requests, merged by squashing: the commit on `main` takes the pull request title, a single-line [Conventional Commit](https://www.conventionalcommits.org/) (`<type>[(scope)][!]: <description>`). The rules for code and documentation are in [`AGENTS.md`](AGENTS.md).

## License

Zenit is free software under the GNU General Public License, version 3 or (at your option) any later version ([`LICENSE`](LICENSE)), with the additional permission in [`LICENSE-EXCEPTION`](LICENSE-EXCEPTION) for the binary-only libraries Espressif distributes. Third-party licenses are described in [`LICENSES/README.md`](LICENSES/README.md).
