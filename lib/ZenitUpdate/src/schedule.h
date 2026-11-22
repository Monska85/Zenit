// SPDX-License-Identifier: GPL-3.0-or-later

// When the board checks for updates and when it may install one (docs/board/wifi-and-updates-v1.md#modes-and-checks).

#pragma once

#include <cstdint>

#include <board_settings.h>

namespace zenit
{
namespace update
{

constexpr uint32_t FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;
constexpr uint32_t RETRY_AFTER_FAILURE_MS = 30 * 60 * 1000;
// The waits between tries to repair a missing or incompatible web app: the first, doubled after each failure up to the
// last.
constexpr uint32_t REPAIR_FIRST_WAIT_MS = 60 * 1000;
constexpr uint32_t REPAIR_MAX_WAIT_MS = 60 * 60 * 1000;

// Whether firmware updates are on at all: the mode is not off and update_firmware is set.
bool firmware_updates_on(const net::BoardSettings &settings);

// Whether web app updates are on: the mode is not off and update_web is set.
bool web_updates_on(const net::BoardSettings &settings);

// Whether the minute of the day `minute` is inside the window. Equal start and end are the whole day; an end before
// the start runs over midnight.
bool in_window(uint16_t start, uint16_t end, uint16_t minute);

// Whether an automatic install may start: the mode is automatic, and the window is the whole day, or the local minute
// is known and inside it. `minute_known` false means the time is not synced.
bool automatic_install_allowed(const net::BoardSettings &settings, bool minute_known, uint16_t minute);

// The same for a web app update: the mode is automatic, update_web is set and the window allows it.
bool automatic_web_install_allowed(const net::BoardSettings &settings, bool minute_known, uint16_t minute);

// The wait before the next try to repair the web app after `failures` failed tries in a row (0: no wait): 1 minute,
// doubled each time up to 60 minutes, then varied from 80 % to 120 % by `random_permille` (0 to 1000).
uint32_t repair_wait_ms(uint32_t failures, uint16_t random_permille);

// Whether a check is due. `ready_since_ms` is when the board became connected with its time synced; `attempted` says a
// check has been tried since the start, at `last_attempt_ms`, and `last_failed` whether it failed.
bool check_due(uint64_t now_ms, uint64_t ready_since_ms, bool attempted, uint64_t last_attempt_ms, bool last_failed,
               uint32_t check_hours);

} // namespace update
} // namespace zenit
