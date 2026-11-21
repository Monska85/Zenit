# Zenit

Firmware for Zenit, a star projector: one RGBW power LED under a perforated dome projects a starry sky or Christmas shapes on the ceiling. An ESP32-C3 SuperMini drives the four colors through MOSFET modules with a perceptual brightness curve, a power limit, effects, smooth transitions and a switch-off timer. A simulator runs the same code on your computer, without any hardware.

The project is under construction. This version holds the light engine, the simulator and the tests; the command protocol, the web app, WiFi and over-the-air updates follow.

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
| `just test`       | Run the native tests and the conformance cases                                              |
| `just tools-test` | Run the Python tool tests                                                                   |
| `just format`     | Format the C++ sources                                                                      |
| `just check`      | Check formatting, run every test suite and build the firmware and the simulator             |
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

## Project layout

| Path                    | Content                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `lib/ZenitLight/`       | The light engine: curve, power limit, effects, transitions and timer. Plain C++, no hardware    |
| `src/main.cpp`          | `setup()` and `loop()` of the board                                                             |
| `src/app.cpp`           | The light engine on the loop task, with its settings and outputs                                |
| `src/output_*.cpp`      | The LED outputs: LEDC PWM on the board (`_board`), a recorder in the simulator (`_sim`)         |
| `src/settings*.cpp`     | The settings, in NVS on the board and in memory in the simulator                                |
| `src/platform*.cpp`     | Clock, randomness, log and build identity                                                       |
| `src/sim_main.cpp`      | Entry point of the simulator                                                                    |
| `test/`                 | Native tests, run on the simulator                                                              |
| `conformance/`          | Test cases worked out by hand from the specifications                                           |
| `tools/`, `scripts/`    | The firmware version rules and the PlatformIO build scripts                                     |
| `docs/`                 | Requirements, hardware reference, decisions and specifications                                  |

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`: `actionlint` checks the workflows, and `check` runs `make check`, checks that the firmware leaves 64 KiB of its slot free and attaches a simulator trace of every effect. On a pull request that changes only documentation (`docs/` and Markdown files), `check` is skipped and reports success.

## Contributing

Changes reach `main` through pull requests, merged by squashing: the commit on `main` takes the pull request title, a single-line [Conventional Commit](https://www.conventionalcommits.org/) (`<type>[(scope)][!]: <description>`). The rules for code and documentation are in [`AGENTS.md`](AGENTS.md).

## License

Zenit is free software under the GNU General Public License, version 3 or (at your option) any later version ([`LICENSE`](LICENSE)), with the additional permission in [`LICENSE-EXCEPTION`](LICENSE-EXCEPTION) for the binary-only libraries Espressif distributes. Third-party licenses are described in [`LICENSES/README.md`](LICENSES/README.md).
