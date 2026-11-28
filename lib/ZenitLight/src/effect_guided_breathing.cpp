// SPDX-License-Identifier: GPL-3.0-or-later

#include "effects.h"

namespace zenit
{

namespace
{
enum class Phase : uint8_t
{
  In,
  HoldFull,
  Out,
  HoldLow
};
struct Step
{
  Phase phase;
  uint32_t ms;
};
// The phases of each pattern, in the order of BreathPattern (docs/board/light-v1.md#guided_breathing).
const Step FOUR_SEVEN_EIGHT[] = {{Phase::In, 4000}, {Phase::HoldFull, 7000}, {Phase::Out, 8000}};
const Step BOX[] = {{Phase::In, 4000}, {Phase::HoldFull, 4000}, {Phase::Out, 4000}, {Phase::HoldLow, 4000}};

template <size_t N> double factor(const Step (&steps)[N], uint64_t t_ms, double low)
{
  uint64_t cycle = 0;
  for (const Step &step : steps)
    cycle += step.ms;
  uint64_t u = t_ms % cycle;
  for (const Step &step : steps)
  {
    if (u < step.ms)
    {
      const double p = static_cast<double>(u) / step.ms;
      switch (step.phase)
      {
      case Phase::In:
        return low + (1000.0 - low) * ease(p);
      case Phase::HoldFull:
        return 1000.0;
      case Phase::Out:
        return 1000.0 - (1000.0 - low) * ease(p);
      case Phase::HoldLow:
        return low;
      }
    }
    u -= step.ms;
  }
  return low;
}
} // namespace

EffectOutput GuidedBreathingEffect::at(EffectState &, const LightSettings &settings, uint64_t t_ms, const TimerView &)
{
  const double low = settings.floor * 10.0;
  if (settings.breath_pattern == BreathPattern::Box)
    return {settings.color, factor(BOX, t_ms, low)};
  return {settings.color, factor(FOUR_SEVEN_EIGHT, t_ms, low)};
}

} // namespace zenit
