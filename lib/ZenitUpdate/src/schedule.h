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

// Whether firmware updates are on at all: the mode is not off and update_firmware is set.
bool firmware_updates_on(const net::BoardSettings &settings);

// Whether the minute of the day `minute` is inside the window. Equal start and end are the whole day; an end before
// the start runs over midnight.
bool in_window(uint16_t start, uint16_t end, uint16_t minute);

// Whether an automatic install may start: the mode is automatic, and the window is the whole day, or the local minute
// is known and inside it. `minute_known` false means the time is not synced.
bool automatic_install_allowed(const net::BoardSettings &settings, bool minute_known, uint16_t minute);

// Whether a check is due. `ready_since_ms` is when the board became connected with its time synced; `attempted` says a
// check has been tried since the start, at `last_attempt_ms`, and `last_failed` whether it failed.
bool check_due(uint64_t now_ms, uint64_t ready_since_ms, bool attempted, uint64_t last_attempt_ms, bool last_failed,
               uint32_t check_hours);

} // namespace update
} // namespace zenit
