// SPDX-License-Identifier: GPL-3.0-or-later

#include "effects.h"

#include <cmath>

namespace zenit
{

// docs/board/light-v1.md#breathing: breaths that drift a little in length and depth.
EffectOutput BreathingEffect::at(EffectState &, const LightSettings &settings, uint64_t t_ms, const TimerView &)
{
  const uint64_t period = static_cast<uint64_t>(settings.period_seconds) * 1000;
  // 1961 periods hold a whole number of each slow wave (3.7 and 5.3 periods): the remainder keeps doubles exact.
  const double a = static_cast<double>(t_ms % (1961 * period)) / static_cast<double>(period);
  const double phase = 2.0 * M_PI * a + 0.45 * std::sin(2.0 * M_PI * a / 3.7);
  const double depth = 0.86 + 0.14 * std::sin(2.0 * M_PI * a / 5.3 + 1.1);
  const double low = settings.floor * 10.0;
  return {settings.color, low + (1000.0 - low) * depth * (1.0 + std::cos(phase)) / 2.0};
}

} // namespace zenit
