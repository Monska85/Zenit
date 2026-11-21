// SPDX-License-Identifier: GPL-3.0-or-later

#include "effects.h"

namespace zenit
{

namespace
{
double draw_target(EffectState &state, uint8_t strength)
{
  const uint32_t span = 10u * strength;
  return 1000.0 - span + xorshift32(state.random) % (span + 1);
}
} // namespace

void TwinkleEffect::reset(EffectState &state, const LightSettings &settings, uint32_t seed)
{
  state.random = seed ? seed : 1;
  state.segment = 0;
  state.from = 1000.0;
  state.to = draw_target(state, settings.twinkle_strength);
}

EffectOutput TwinkleEffect::at(EffectState &state, const LightSettings &settings, uint64_t t_ms, const TimerView &)
{
  const uint64_t segment = t_ms / SEGMENT_MS;
  while (state.segment < segment)
  {
    state.from = state.to;
    state.to = draw_target(state, settings.twinkle_strength);
    state.segment++;
  }
  const double u = static_cast<double>(t_ms % SEGMENT_MS) / SEGMENT_MS;
  return {settings.color, state.from + (state.to - state.from) * u};
}

} // namespace zenit
