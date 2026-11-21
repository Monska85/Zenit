// SPDX-License-Identifier: GPL-3.0-or-later

// What differs between the board and the simulator: the clock, randomness, the log and the build identity.

#pragma once

#include <cstdint>

namespace platform
{

// Monotonic time in milliseconds since the start. In the simulator this is the virtual clock.
uint64_t now_ms();

// A random word, for seeds and identifiers that need no secrecy.
uint32_t random32();

// Writes one log line, `zenit: ` and the text, to the serial port (the simulator's standard output).
void log(const char *format, ...) __attribute__((format(printf, 1, 2)));

// Set at build time by scripts/firmware_version.py.
const char *firmware_version();
const char *board_name();

#ifdef ZENIT_SIM
// Simulator: sets the virtual clock.
void sim_set_now_ms(uint64_t now);
// Simulator: the value random32() returns next, then it counts up from there.
void sim_set_random(uint32_t value);
// Simulator: whether log lines are printed (tests keep them quiet).
void sim_set_log(bool enabled);
#endif

} // namespace platform
