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
SIM := .pio/build/native/program

ifeq ($(shell printf '%s' '$(JOBS)' | grep -Ex '[1-9][0-9]*'),)
$(error JOBS must be a whole number of 1 or more, got '$(JOBS)')
endif
ifeq ($(shell printf '%s' '$(NICE)' | grep -Ex '[0-9]|1[0-9]'),)
$(error NICE must be a whole number from 0 to 19, got '$(NICE)')
endif

UPLOAD_PORT := $(if $(PORT),--upload-port $(PORT),)
MONITOR_PORT := $(if $(PORT),--port $(PORT),)

.PHONY: help build upload monitor flash sim-build sim sim-live test tools-test format format-check check clean

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:.*## /\t/' | expand -t 16

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

test: ## Run the tests on the simulator
	nice -n $(NICE) pio test -e native_test

tools-test: ## Run the Python tool tests
	nice -n $(NICE) $(PYTHON) -m unittest discover -s tools

format: ## Format the C++ sources with clang-format
	find src include test lib \( -name '*.cpp' -o -name '*.h' \) -exec nice -n $(NICE) clang-format -i {} +

format-check: ## Fail if a C++ source is not formatted
	find src include test lib \( -name '*.cpp' -o -name '*.h' \) -exec nice -n $(NICE) clang-format --dry-run --Werror {} +

check: format-check ## Check formatting, run every test suite and build the firmware and the simulator
	nice -n $(NICE) $(PYTHON) -m unittest discover -s tools
	nice -n $(NICE) pio test -e native_test
	nice -n $(NICE) pio run -j $(JOBS) -e native -e $(BOARD)

clean: ## Remove build outputs and simulator output
	pio run -t clean -e native -e native_test -e $(BOARD)
	rm -rf $(OUT)
