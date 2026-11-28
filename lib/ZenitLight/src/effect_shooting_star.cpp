// SPDX-License-Identifier: GPL-3.0-or-later

#include "effects.h"

#include <cmath>

namespace zenit
{

namespace
{
uint32_t draw_wait(EffectState &state)
{
  return ShootingStarEffect::MIN_WAIT_MS +
         xorshift32(state.random) % (ShootingStarEffect::MAX_WAIT_MS - ShootingStarEffect::MIN_WAIT_MS + 1);
}
} // namespace

// docs/board/light-v1.md#shooting_star: one draw at the start, then one at each flash.
void ShootingStarEffect::reset(EffectState &state, const LightSettings &, uint32_t seed)
{
  state.random = seed ? seed : 1;
  state.flashed = false;
  state.start = 0;
  state.until = draw_wait(state);
}

EffectOutput ShootingStarEffect::at(EffectState &state, const LightSettings &settings, uint64_t t_ms, const TimerView &)
{
  while (t_ms >= state.until)
  {
    state.flashed = true;
    state.start = state.until;
    state.until = state.start + draw_wait(state);
  }
  if (!state.flashed)
    return {settings.color, SKY};
  const uint64_t e = t_ms - state.start;
  if (e < RISE_MS)
    return {settings.color, SKY + (1000.0 - SKY) * static_cast<double>(e) / RISE_MS};
  return {settings.color, SKY + (1000.0 - SKY) * std::exp(-static_cast<double>(e - RISE_MS) / DECAY_MS)};
}

} // namespace zenit
