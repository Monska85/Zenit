// SPDX-License-Identifier: GPL-3.0-or-later

#include "schedule.h"

namespace zenit
{
namespace update
{

bool firmware_updates_on(const net::BoardSettings &s)
{
  return s.update_mode != net::UpdateMode::Off && s.update_firmware;
}

bool in_window(uint16_t start, uint16_t end, uint16_t minute)
{
  if (start == end)
    return true;
  if (start < end)
    return minute >= start && minute < end;
  return minute >= start || minute < end;
}

bool automatic_install_allowed(const net::BoardSettings &s, bool minute_known, uint16_t minute)
{
  if (s.update_mode != net::UpdateMode::Automatic || !s.update_firmware)
    return false;
  if (s.install_start == s.install_end)
    return true;
  return minute_known && in_window(s.install_start, s.install_end, minute);
}

bool check_due(uint64_t now_ms, uint64_t ready_since_ms, bool attempted, uint64_t last_attempt_ms, bool last_failed,
               uint32_t check_hours)
{
  if (!attempted)
    return now_ms >= ready_since_ms + FIRST_CHECK_DELAY_MS;
  const uint64_t interval = last_failed ? RETRY_AFTER_FAILURE_MS : static_cast<uint64_t>(check_hours) * 3600u * 1000u;
  return now_ms >= last_attempt_ms + interval;
}

} // namespace update
} // namespace zenit
