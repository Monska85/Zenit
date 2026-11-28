// SPDX-License-Identifier: GPL-3.0-or-later

#include "effects.h"

#include <cmath>

namespace zenit
{

namespace
{
// The next knot (docs/board/light-v1.md#twinkle): three draws, its length, whether it dips deep, its target.
void draw_knot(EffectState &state, uint8_t strength)
{
  const uint32_t length = TwinkleEffect::MIN_KNOT_MS +
                          xorshift32(state.random) % (TwinkleEffect::MAX_KNOT_MS - TwinkleEffect::MIN_KNOT_MS + 1);
  const bool deep = xorshift32(state.random) % 100 < 7;
  const uint32_t draw = xorshift32(state.random);
  state.start = state.until;
  state.until = state.start + length;
  state.from = state.to;
  if (deep)
    state.to = 1000.0 - 14.0 * strength + draw % (4u * strength + 1);
  else
    state.to = 1000.0 - 10.0 * strength * std::pow((draw % 1001) / 1000.0, 1.6);
}
} // namespace

void TwinkleEffect::reset(EffectState &state, const LightSettings &settings, uint32_t seed)
{
  state.random = seed ? seed : 1;
  state.until = 0;
  state.to = 1000.0;
  draw_knot(state, settings.twinkle_strength);
}

EffectOutput TwinkleEffect::at(EffectState &state, const LightSettings &settings, uint64_t t_ms, const TimerView &)
{
  while (t_ms >= state.until)
    draw_knot(state, settings.twinkle_strength);
  const double p = static_cast<double>(t_ms - state.start) / static_cast<double>(state.until - state.start);
  return {settings.color, state.from + (state.to - state.from) * ease(p)};
}

} // namespace zenit
