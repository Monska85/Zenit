// SPDX-License-Identifier: GPL-3.0-or-later

#include "effects.h"

namespace zenit
{

EffectOutput ColorChangeEffect::cycle(const ColorList &colors, uint16_t hold_seconds, uint8_t floor, uint64_t t_ms)
{
  const uint64_t period = (static_cast<uint64_t>(hold_seconds) + 2) * 1000;
  const uint64_t index = t_ms / period;
  const uint64_t u = t_ms % period;
  const double low = floor * 10.0;
  EffectOutput out;
  out.color = colors.color[colors.count ? index % colors.count : 0];
  if (u < 1000)
    out.factor = index == 0 ? 1000.0 : low + (1000.0 - low) * u / 1000.0;
  else if (u < period - 1000)
    out.factor = 1000.0;
  else
    out.factor = 1000.0 - (1000.0 - low) * (u - (period - 1000)) / 1000.0;
  return out;
}

EffectOutput ColorChangeEffect::at(EffectState &, const LightSettings &settings, uint64_t t_ms, const TimerView &)
{
  return cycle(settings.colors, settings.hold_seconds, settings.floor, t_ms);
}

} // namespace zenit
