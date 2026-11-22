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

bool web_updates_on(const net::BoardSettings &s) { return s.update_mode != net::UpdateMode::Off && s.update_web; }

namespace
{
bool automatic_now(const net::BoardSettings &s, bool minute_known, uint16_t minute)
{
  if (s.update_mode != net::UpdateMode::Automatic)
    return false;
  if (s.install_start == s.install_end)
    return true;
  return minute_known && in_window(s.install_start, s.install_end, minute);
}
} // namespace

bool automatic_install_allowed(const net::BoardSettings &s, bool minute_known, uint16_t minute)
{
  return s.update_firmware && automatic_now(s, minute_known, minute);
}

bool automatic_web_install_allowed(const net::BoardSettings &s, bool minute_known, uint16_t minute)
{
  return s.update_web && automatic_now(s, minute_known, minute);
}

uint32_t repair_wait_ms(uint32_t failures, uint16_t random_permille)
{
  if (failures == 0)
    return 0;
  uint64_t wait = REPAIR_FIRST_WAIT_MS;
  for (uint32_t i = 1; i < failures && wait < REPAIR_MAX_WAIT_MS; i++)
    wait *= 2;
  if (wait > REPAIR_MAX_WAIT_MS)
    wait = REPAIR_MAX_WAIT_MS;
  if (random_permille > 1000)
    random_permille = 1000;
  // From 80 % to 120 % of the wait, so boards that failed together do not all ask again at once.
  return static_cast<uint32_t>(wait * (800 + 400 * static_cast<uint64_t>(random_permille) / 1000) / 1000);
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
