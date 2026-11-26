// SPDX-License-Identifier: GPL-3.0-or-later

#ifndef ZENIT_SIM

#include "platform.h"

#include <Arduino.h>
#include <bootloader_random.h>
#include <esp_heap_caps.h>
#include <esp_random.h>
#include <esp_timer.h>
#include <esp_wifi.h>
#include <nvs_flash.h>

#include "task_sync.h"

#include <cstdarg>
#include <cstdio>

namespace platform
{

uint64_t now_ms() { return static_cast<uint64_t>(esp_timer_get_time()) / 1000; }

uint32_t random32() { return esp_random(); }

Lock &radio_lock()
{
  static Lock lock;
  return lock;
}

void random_bytes(uint8_t *out, size_t size)
{
  // Without the radio the generator is not seeded by noise: the bootloader's entropy source stands in for it while
  // WiFi has not been initialized. The network task changes the radio mode only while it holds the same lock, so WiFi
  // cannot start between the check and the disable.
  Locked held(radio_lock());
  wifi_mode_t mode;
  const bool radio = esp_wifi_get_mode(&mode) != ESP_ERR_WIFI_NOT_INIT;
  if (!radio)
    bootloader_random_enable();
  esp_fill_random(out, size);
  if (!radio)
    bootloader_random_disable();
}

MemoryInfo memory_info()
{
  return {static_cast<uint32_t>(heap_caps_get_free_size(MALLOC_CAP_8BIT)),
          static_cast<uint32_t>(heap_caps_get_largest_free_block(MALLOC_CAP_8BIT))};
}

NvsInfo nvs_info()
{
  nvs_stats_t stats;
  if (nvs_get_stats(nullptr, &stats) != ESP_OK)
    return {0, 0};
  return {static_cast<uint32_t>(stats.used_entries), static_cast<uint32_t>(stats.free_entries)};
}

uint32_t stack_free_min() { return uxTaskGetStackHighWaterMark(nullptr); }

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
