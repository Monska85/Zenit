// SPDX-License-Identifier: GPL-3.0-or-later

// What differs between the board and the simulator: the clock, randomness, the log and the build identity.

#pragma once

#include <cstddef>
#include <cstdint>

class Lock;

namespace platform
{

// Monotonic time in milliseconds since the start. In the simulator this is the virtual clock.
uint64_t now_ms();

// A random word, for seeds and identifiers that need no secrecy.
uint32_t random32();

// Hardware random bytes, for the token, the login nonce and anything that needs secrecy. On the board, before the
// radio has started, the draw enables the bootloader's entropy source so the bytes are random then too.
void random_bytes(uint8_t *out, size_t size);

#ifndef ZENIT_SIM
// Board: held while the radio mode changes (the network task) and while random_bytes() looks at the radio and uses the
// bootloader's entropy source, which must never be on while the radio starts or runs.
Lock &radio_lock();
#endif

// Writes one log line, `zenit: ` and the text, to the serial port (the simulator's standard output).
void log(const char *format, ...) __attribute__((format(printf, 1, 2)));

// Heap bytes for `info`: the free total and the largest block that can be allocated. 0 and 0 in the simulator.
struct MemoryInfo
{
  uint32_t free;
  uint32_t largest;
};
MemoryInfo memory_info();

// Entries of the settings memory for `info`: in use and free. 0 and 0 in the simulator.
struct NvsInfo
{
  uint32_t used;
  uint32_t free;
};
NvsInfo nvs_info();

// Set at build time by scripts/firmware_version.py.
const char *firmware_version();
const char *board_name();

#ifndef ZENIT_SIM
// Board: the least free stack the calling task has had since it started, in bytes.
uint32_t stack_free_min();
#endif

#ifdef ZENIT_SIM
// Simulator: the bytes random_bytes() returns next, before it goes back to its repeatable generator.
void sim_queue_random_bytes(const uint8_t *bytes, size_t size);
// Simulator: the version firmware_version() reports from now on (a restart into a new image).
void sim_set_version(const char *version);
// Simulator: sets the virtual clock.
void sim_set_now_ms(uint64_t now);
// Simulator: the value random32() returns next, then it counts up from there.
void sim_set_random(uint32_t value);
// Simulator: whether log lines are printed (tests keep them quiet).
void sim_set_log(bool enabled);
#endif

} // namespace platform
