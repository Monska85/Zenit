// SPDX-License-Identifier: GPL-3.0-or-later

#include "effects.h"

namespace zenit
{

EffectOutput FallAsleepEffect::at(EffectState &, const LightSettings &settings, uint64_t, const TimerView &timer)
{
  if (!timer.running || timer.duration_ms == 0)
    return {settings.color, 1000.0};
  const double low = settings.floor * 10.0;
  const uint64_t elapsed = timer.elapsed_ms < timer.duration_ms ? timer.elapsed_ms : timer.duration_ms;
  return {settings.color, 1000.0 - (1000.0 - low) * static_cast<double>(elapsed) / timer.duration_ms};
}

} // namespace zenit
