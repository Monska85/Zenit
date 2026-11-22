// SPDX-License-Identifier: GPL-3.0-or-later

// The board's time zone and the local time of day. The loop task owns the process's time zone.

#pragma once

#include <cstdint>

namespace net_time
{

// Makes `posix_tz` the zone of this process.
void set_zone(const char *posix_tz);
// The minute of the day (0 to 1439) of a Unix time in that zone.
int local_minute(int64_t epoch);

} // namespace net_time
