# The same commands as the justfile. Run `make help` to list them.
#
# Resource limits, set for a laptop: at most JOBS parallel jobs and the priority NICE for the heavy steps (0 is
# normal, 19 the lowest). Override per run: `make check JOBS=8 NICE=0`.

BOARD ?= esp32c3
PORT ?=
OUT ?= sim-out
PYTHON ?= python3
JOBS ?= 4
NICE ?= 10
ARGS ?=
VERSION ?=
SIM := .pio/build/native/program

ifeq ($(shell printf '%s' '$(JOBS)' | grep -Ex '[1-9][0-9]*'),)
$(error JOBS must be a whole number of 1 or more, got '$(JOBS)')
endif
ifeq ($(shell printf '%s' '$(NICE)' | grep -Ex '[0-9]|1[0-9]'),)
$(error NICE must be a whole number from 0 to 19, got '$(NICE)')
endif

UPLOAD_PORT := $(if $(PORT),--upload-port $(PORT),)
MONITOR_PORT := $(if $(PORT),--port $(PORT),)

.PHONY: help build upload monitor flash sim-build sim sim-live serve cli test tools-test notices release-assets format format-check check clean web-install web-dev web-format web-test web-build web-size web-e2e web-screenshots web-screenshots-update web-check

help: ## List the targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:.*## /\t/' | expand -t 16

build: ## Build the firmware
	nice -n $(NICE) pio run -j $(JOBS) -e $(BOARD)

upload: ## Flash the firmware (PORT=/dev/ttyACM0 to choose the port). Never with the panel socket powered
	nice -n $(NICE) pio run -j $(JOBS) -e $(BOARD) -t upload $(UPLOAD_PORT)

monitor: ## Open the serial monitor
	pio device monitor -e $(BOARD) $(MONITOR_PORT)

flash: upload ## Flash the firmware, then open the serial monitor
	pio device monitor -e $(BOARD) $(MONITOR_PORT)

sim-build: ## Build the host simulator
	nice -n $(NICE) pio run -j $(JOBS) -e native

sim: sim-build ## Run the simulator and write trace.csv and viewer.html (ARGS="--set effect=breathing")
	$(SIM) --out $(OUT) $(ARGS)

sim-live: sim-build ## Run the simulator in real time and draw the light in the terminal
	$(SIM) --live --no-files $(ARGS)

serve: sim-build ## Serve the simulator on a local WebSocket for the web app (ARGS="--port 9000")
	$(PYTHON) tools/ws_bridge.py --sim $(SIM) $(ARGS)

cli: ## Run the command line client against a board or the simulator (ARGS="--port /dev/ttyACM0 info")
	$(PYTHON) tools/zenit.py $(ARGS)

test: ## Run the tests on the simulator
	nice -n $(NICE) pio test -e native_test

tools-test: ## Run the Python tool tests (the simulator tests need `make sim-build` first)
	nice -n $(NICE) $(PYTHON) -m unittest discover -s tools

notices: ## Write the third-party notices of the firmware build (`make build` first)
	$(PYTHON) tools/firmware_notices.py --version check --out .pio/build/$(BOARD)/THIRD_PARTY_NOTICES.txt

release-assets: ## Build the files of a release in release/ (VERSION=1.2.3): factory image, firmware, notices, checksums
	@test -n "$(VERSION)" || { echo "VERSION is required, e.g. make release-assets VERSION=1.2.3"; exit 1; }
	ZENIT_VERSION=$(VERSION) nice -n $(NICE) pio run -j $(JOBS) -e $(BOARD)
	$(PYTHON) tools/firmware_notices.py --version $(VERSION) --out .pio/build/$(BOARD)/THIRD_PARTY_NOTICES.txt
	$(PYTHON) tools/release_assets.py --version $(VERSION) --out release --notices .pio/build/$(BOARD)/THIRD_PARTY_NOTICES.txt

format: ## Format the C++ sources with clang-format
	find src include test lib \( -name '*.cpp' -o -name '*.h' \) -exec nice -n $(NICE) clang-format -i {} +

format-check: ## Fail if a C++ source is not formatted
	find src include test lib \( -name '*.cpp' -o -name '*.h' \) -exec nice -n $(NICE) clang-format --dry-run --Werror {} +

check: format-check ## Check formatting, run every test suite, build the firmware and the simulator, build the notices
	nice -n $(NICE) pio test -e native_test
	nice -n $(NICE) pio run -j $(JOBS) -e native -e $(BOARD)
	nice -n $(NICE) $(PYTHON) -m unittest discover -s tools
	$(PYTHON) tools/firmware_notices.py --version check --out .pio/build/$(BOARD)/THIRD_PARTY_NOTICES.txt

web/node_modules: web/package-lock.json
	cd web && npm ci
	touch web/node_modules

web-install: ## Install the web app's dependencies from the lockfile
	cd web && npm ci

web-dev: web/node_modules ## Start the web app on http://localhost:5173 with live reload (`make serve` runs the simulator it can connect to)
	cd web && npm run dev

web-format: web/node_modules ## Format the web app with Prettier
	cd web && nice -n $(NICE) npm run format

web-test: web/node_modules ## Type check, lint, check the formatting and run the web app's unit tests and the conformance cases
	cd web && nice -n $(NICE) npm run typecheck
	cd web && nice -n $(NICE) npm run lint
	cd web && nice -n $(NICE) npm run format:check
	cd web && nice -n $(NICE) npm test

web-build: web/node_modules ## Build the web app into web/dist
	cd web && nice -n $(NICE) npm run build

web-size: web-build ## Fail when the JavaScript the web app loads at start is over its budget (150 KB gzip)
	cd web && npm run size

web-e2e: sim-build web-build ## Run the end-to-end tests and layout checks against the built app and the simulator (first: cd web && npx playwright install chromium)
	cd web && ZENIT_JOBS=$(JOBS) nice -n $(NICE) npm run e2e

web-screenshots: web-build ## Compare the reference screenshots, drawn inside the Playwright container (needs Docker)
	ZENIT_JOBS=$(JOBS) nice -n $(NICE) web/scripts/run-screenshots.sh compare

web-screenshots-update: web-build ## Draw the reference screenshots again, inside the Playwright container (needs Docker)
	ZENIT_JOBS=$(JOBS) nice -n $(NICE) web/scripts/run-screenshots.sh update

web-check: web-test web-size web-e2e web-screenshots ## The whole web gate: checks, build, size budget, end-to-end tests and screenshots

clean: ## Remove build outputs and simulator output
	pio run -t clean -e native -e native_test -e $(BOARD)
	rm -rf $(OUT) release web/dist web/test-results* web/playwright-report*
