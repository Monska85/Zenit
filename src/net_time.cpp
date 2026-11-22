// SPDX-License-Identifier: GPL-3.0-or-later

#include "net_time.h"

#include <cstdlib>
#include <ctime>

namespace net_time
{

void set_zone(const char *posix_tz)
{
  setenv("TZ", posix_tz, 1);
  tzset();
}

int local_minute(int64_t epoch)
{
  const time_t seconds = static_cast<time_t>(epoch);
  struct tm local;
  if (!localtime_r(&seconds, &local))
    return 0;
  return local.tm_hour * 60 + local.tm_min;
}

} // namespace net_time
