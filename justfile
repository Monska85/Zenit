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

# Build the firmware
build:
    nice -n {{nice}} pio run -j {{jobs}} -e {{board}}

# Flash the firmware (PORT=/dev/ttyACM0 to choose the port). Never with the panel socket powered
upload:
    nice -n {{nice}} pio run -j {{jobs}} -e {{board}} -t upload {{upload_port}}

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

# Run the tests on the simulator
test:
    nice -n {{nice}} pio test -e native_test

# Run the Python tool tests
tools-test:
    nice -n {{nice}} {{python}} -m unittest discover -s tools

# Format the C++ sources with clang-format
format:
    find src include test lib \( -name '*.cpp' -o -name '*.h' \) -exec nice -n {{nice}} clang-format -i {} +

# Fail if a C++ source is not formatted
format-check:
    find src include test lib \( -name '*.cpp' -o -name '*.h' \) -exec nice -n {{nice}} clang-format --dry-run --Werror {} +

# Check formatting, run every test suite and build the firmware and the simulator
check: format-check
    nice -n {{nice}} {{python}} -m unittest discover -s tools
    nice -n {{nice}} pio test -e native_test
    nice -n {{nice}} pio run -j {{jobs}} -e native -e {{board}}

# Remove build outputs and simulator output
clean:
    pio run -t clean -e native -e native_test -e {{board}}
    rm -rf {{out}}
