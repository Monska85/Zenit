// SPDX-License-Identifier: GPL-3.0-or-later

#include "effects.h"

namespace zenit
{

// docs/board/light-v1.md#hop: the first color is one draw at the start; each later hop draws one of the others.
void HopEffect::reset(EffectState &state, const LightSettings &settings, uint32_t seed)
{
  state.random = seed ? seed : 1;
  state.start = 0;
  state.index = static_cast<uint8_t>(xorshift32(state.random) % color_set_colors(settings.color_set).count);
}

EffectOutput HopEffect::at(EffectState &state, const LightSettings &settings, uint64_t t_ms, const TimerView &)
{
  const ColorList palette = color_set_colors(settings.color_set);
  const uint64_t hop = t_ms / STEP_MS;
  while (state.start < hop)
  {
    const uint32_t other = xorshift32(state.random) % (palette.count - 1u);
    state.index = static_cast<uint8_t>(other < state.index ? other : other + 1);
    state.start++;
  }
  const uint32_t u = static_cast<uint32_t>(t_ms % STEP_MS);
  double factor = 1000.0;
  if (hop > 0 && u < EDGE_MS)
    factor = DIP + (1000.0 - DIP) * ease(static_cast<double>(u) / EDGE_MS);
  else if (u >= STEP_MS - EDGE_MS)
    factor = 1000.0 - (1000.0 - DIP) * ease(static_cast<double>(u - (STEP_MS - EDGE_MS)) / EDGE_MS);
  return {palette.color[state.index % palette.count], factor};
}

} // namespace zenit
