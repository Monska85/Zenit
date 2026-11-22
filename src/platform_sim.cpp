// SPDX-License-Identifier: GPL-3.0-or-later

#ifdef ZENIT_SIM

#include "platform.h"

#include <cstdarg>
#include <cstdio>

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
