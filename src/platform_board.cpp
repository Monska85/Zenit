// SPDX-License-Identifier: GPL-3.0-or-later

#ifndef ZENIT_SIM

#include "platform.h"

#include <Arduino.h>
#include <esp_random.h>
#include <esp_timer.h>

#include <cstdarg>
#include <cstdio>

namespace platform
{

uint64_t now_ms() { return static_cast<uint64_t>(esp_timer_get_time()) / 1000; }

uint32_t random32() { return esp_random(); }

void log(const char *format, ...)
{
  char line[192];
  va_list args;
  va_start(args, format);
  vsnprintf(line, sizeof(line), format, args);
  va_end(args);
  // One write per line, so a log line never mixes with another output.
  char out[208];
  int length = snprintf(out, sizeof(out), "zenit: %s\n", line);
  if (length > 0)
    Serial.write(reinterpret_cast<const uint8_t *>(out), length < (int)sizeof(out) ? length : sizeof(out) - 1);
}

} // namespace platform

#endif
