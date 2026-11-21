// SPDX-License-Identifier: GPL-3.0-or-later

#include "effects.h"

#include <cmath>

namespace zenit
{

EffectOutput BreathingEffect::at(EffectState &, const LightSettings &settings, uint64_t t_ms, const TimerView &)
{
  const double period = settings.period_seconds * 1000.0;
  const double low = settings.floor * 10.0;
  const double phase = static_cast<double>(t_ms % static_cast<uint64_t>(period)) / period;
  return {settings.color, low + (1000.0 - low) * (1.0 + std::cos(2.0 * M_PI * phase)) / 2.0};
}

} // namespace zenit
