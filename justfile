# The same commands as the Makefile, for just users: each recipe has the steps of the make target of the same name.
#
# Resource limits, set for a laptop: at most `jobs` parallel jobs and the priority `nice` for the heavy steps (0 is
# normal, 19 the lowest). Override per run: `JOBS=8 NICE=0 just check` or `just jobs=8 nice=0 check`.

board := "esp32c3"
port := env("PORT", "")
out := "sim-out"
python := "python3"
jobs := env("JOBS", "4")
nice := env("NICE", "10")
# An empty or other value would reach pio as a bad -j and nice as a bad priority: stop before any recipe runs
_jobs_ok := if jobs =~ '^[1-9][0-9]*$' { "" } else { error("jobs (JOBS) must be a whole number of 1 or more, got '" + jobs + "'") }
_nice_ok := if nice =~ '^([0-9]|1[0-9])$' { "" } else { error("nice (NICE) must be a whole number from 0 to 19, got '" + nice + "'") }
upload_port := if port == "" { "" } else { "--upload-port " + port }
monitor_port := if port == "" { "" } else { "--port " + port }
sim := ".pio/build/native/program"

# List recipes
default:
    @just --list

# Build the firmware (the web app is not in it: `just web-image` builds the image of its own partition)
build:
    nice -n {{nice}} pio run -j {{jobs}} -e {{board}}

# Build the update test firmware: like the firmware, but it reads updates from a plain http:// test server (SITE_URL=http://192.168.1.5:8000/, see `just update-server`). Never released
build-update-test site_url:
    ZENIT_SITE_URL={{site_url}} nice -n {{nice}} pio run -j {{jobs}} -e esp32c3_test_http

# Serve update files for the update test firmware (e.g. just update-server --version 1.2.0 --firmware .pio/build/esp32c3/firmware.bin, or --web .pio/web/zenit-web.bin)
update-server *args:
    {{python}} tools/update_server.py {{args}}

# Flash the firmware (PORT=/dev/ttyACM0 to choose the port). Never with the panel socket powered
upload:
    nice -n {{nice}} pio run -j {{jobs}} -e {{board}} -t upload {{upload_port}}

# Build the web app and its image for the board's www partition, .pio/web/zenit-web.bin (version of web/package.json)
web-image: web-build
    {{python}} tools/web_image.py --dist web/dist --out .pio/web/zenit-web.bin

# Write the web image to the board's www partition (PORT=/dev/ttyACM0 to choose the port)
upload-web: web-image
    pio run -e {{board}} -t upload_web {{upload_port}}

# Open the serial monitor
monitor:
    pio device monitor -e {{board}} {{monitor_port}}

# Flash the firmware, then open the serial monitor
flash: upload
    pio device monitor -e {{board}} {{monitor_port}}

# Build the host simulator
sim-build:
    nice -n {{nice}} pio run -j {{jobs}} -e native

# Run the simulator and write trace.csv and viewer.html (e.g. just sim --set effect=breathing --duration 30)
sim *args: sim-build
    {{sim}} --out {{out}} {{args}}

# Run the simulator in real time and draw the light in the terminal
sim-live *args: sim-build
    {{sim}} --live --no-files {{args}}

# Serve the simulator on a local WebSocket for the web app (e.g. just serve --port 9000); `just serve --app web/dist` also serves the built app, as a board does
serve *args: sim-build
    {{python}} tools/ws_bridge.py --sim {{sim}} {{args}}

# Run the command line client against a board or the simulator (e.g. just cli --port /dev/ttyACM0 info)
cli *args:
    {{python}} tools/zenit.py {{args}}

# Run the tests on the simulator
test:
    nice -n {{nice}} pio test -e native_test

# Run the Python tool tests (the simulator tests need `just sim-build` first)
tools-test:
    nice -n {{nice}} {{python}} -m unittest discover -s tools

# Write the third-party notices of the firmware build (`just build` first)
notices:
    {{python}} tools/firmware_notices.py --version check --out .pio/build/{{board}}/THIRD_PARTY_NOTICES.txt

# Build the files of a release in release/ (e.g. just release-assets 1.2.3): factory image, firmware, notices, checksums
release-assets version:
    ZENIT_VERSION={{version}} nice -n {{nice}} pio run -j {{jobs}} -e {{board}}
    {{python}} tools/firmware_notices.py --version {{version}} --out .pio/build/{{board}}/THIRD_PARTY_NOTICES.txt
    {{python}} tools/release_assets.py --version {{version}} --out release --notices .pio/build/{{board}}/THIRD_PARTY_NOTICES.txt

# Format the C++ sources with clang-format
format:
    find src include test lib \( -name '*.cpp' -o -name '*.h' \) -exec nice -n {{nice}} clang-format -i {} +

# Fail if a C++ source is not formatted
format-check:
    find src include test lib \( -name '*.cpp' -o -name '*.h' \) -exec nice -n {{nice}} clang-format --dry-run --Werror {} +

# Check formatting, run every test suite, build the firmware and the simulator, build the notices
check: format-check
    nice -n {{nice}} pio test -e native_test
    nice -n {{nice}} pio run -j {{jobs}} -e native -e {{board}}
    nice -n {{nice}} {{python}} -m unittest discover -s tools
    {{python}} tools/firmware_notices.py --version check --out .pio/build/{{board}}/THIRD_PARTY_NOTICES.txt

# Install the web app's dependencies from the lockfile
web-install:
    cd web && npm ci

# Run npm ci in web/ only when node_modules is missing or older than the lockfile, like make's web/node_modules
[private]
node-modules:
    #!/usr/bin/env sh
    set -eu
    if [ ! -d web/node_modules ] || [ web/package-lock.json -nt web/node_modules ]; then
        (cd web && npm ci)
        touch web/node_modules
    fi

# Start the web app on http://localhost:5173 with live reload (`just serve` runs the simulator it can connect to)
web-dev: node-modules
    cd web && npm run dev

# Format the web app with Prettier
web-format: node-modules
    cd web && nice -n {{nice}} npm run format

# Type check, lint, check the formatting and run the web app's unit tests and the conformance cases
web-test: node-modules
    cd web && nice -n {{nice}} npm run typecheck
    cd web && nice -n {{nice}} npm run lint
    cd web && nice -n {{nice}} npm run format:check
    cd web && nice -n {{nice}} npm test

# Build the web app into web/dist
web-build: node-modules
    cd web && nice -n {{nice}} npm run build

# Fail when the JavaScript the web app loads at start is over its budget (150 KB gzip)
web-size: web-build
    cd web && npm run size

# Run the end-to-end tests and the layout checks against the built app and the simulator (first: cd web && npx playwright install chromium)
web-e2e: sim-build web-build
    cd web && ZENIT_JOBS={{jobs}} nice -n {{nice}} npm run e2e

# Compare the reference screenshots, drawn inside the Playwright container (needs Docker)
web-screenshots: web-build
    ZENIT_JOBS={{jobs}} nice -n {{nice}} web/scripts/run-screenshots.sh compare

# Draw the reference screenshots again, inside the Playwright container (needs Docker)
web-screenshots-update: web-build
    ZENIT_JOBS={{jobs}} nice -n {{nice}} web/scripts/run-screenshots.sh update

# The whole web gate: checks, build, size budget, end-to-end tests and screenshots
web-check: web-test web-size web-e2e web-screenshots

# Remove build outputs and simulator output
clean:
    pio run -t clean -e native -e native_test -e {{board}} -e esp32c3_test_http
    rm -rf {{out}} release web/dist web/test-results* web/playwright-report* .pio/web
