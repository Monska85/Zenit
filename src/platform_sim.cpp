// SPDX-License-Identifier: GPL-3.0-or-later

#ifdef ZENIT_SIM

#include "platform.h"

#include <cstdarg>
#include <cstdio>
#include <vector>

namespace platform
{

namespace
{
uint64_t now = 0;
uint32_t next_random = 1;
bool log_enabled = true;
} // namespace

uint64_t now_ms() { return now; }

uint32_t random32() { return next_random++; }

namespace
{
std::vector<uint8_t> queued_random;
} // namespace

void sim_queue_random_bytes(const uint8_t *bytes, size_t size) { queued_random.assign(bytes, bytes + size); }

void random_bytes(uint8_t *out, size_t size)
{
  size_t at = 0;
  for (; at < size && !queued_random.empty(); at++)
  {
    out[at] = queued_random.front();
    queued_random.erase(queued_random.begin());
  }
  out += at;
  size -= at;
  // Repeatable, so a run of the simulator is: a linear congruential generator seeded by the sim's random word.
  static uint32_t state = 0x2545F491;
  state ^= next_random++;
  for (size_t i = 0; i < size; i++)
  {
    state = state * 1664525u + 1013904223u;
    out[i] = static_cast<uint8_t>(state >> 24);
  }
}

MemoryInfo memory_info() { return {0, 0}; }
NvsInfo nvs_info() { return {0, 0}; }

void log(const char *format, ...)
{
  if (!log_enabled)
    return;
  va_list args;
  va_start(args, format);
  std::fputs("zenit: ", stdout);
  std::vfprintf(stdout, format, args);
  std::fputc('\n', stdout);
  va_end(args);
}

void sim_set_now_ms(uint64_t value) { now = value; }
void sim_set_random(uint32_t value) { next_random = value; }
void sim_set_log(bool enabled) { log_enabled = enabled; }

} // namespace platform

#endif
