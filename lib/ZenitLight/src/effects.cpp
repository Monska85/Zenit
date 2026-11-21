// SPDX-License-Identifier: GPL-3.0-or-later

#include "effects.h"

namespace zenit
{

namespace
{
// The registry, in the order of Effect.
const EffectInfo EFFECTS[EFFECT_COUNT] = {
    {Effect::Static, PARAM_COLOR, StaticEffect::reset, StaticEffect::at},
    {Effect::ColorChange, PARAM_COLORS | PARAM_HOLD | PARAM_FLOOR, ColorChangeEffect::reset, ColorChangeEffect::at},
    {Effect::Breathing, PARAM_COLOR | PARAM_PERIOD | PARAM_FLOOR, BreathingEffect::reset, BreathingEffect::at},
    {Effect::Twinkle, PARAM_COLOR | PARAM_STRENGTH, TwinkleEffect::reset, TwinkleEffect::at},
    {Effect::FallAsleep, PARAM_COLOR | PARAM_FLOOR | PARAM_TIMER, FallAsleepEffect::reset, FallAsleepEffect::at},
    {Effect::Christmas, PARAM_COLOR_SET | PARAM_HOLD | PARAM_FLOOR, ChristmasEffect::reset, ChristmasEffect::at},
};
static_assert(sizeof(EFFECTS) / sizeof(EFFECTS[0]) == EFFECT_COUNT, "one registry row per effect");
} // namespace

const EffectInfo &effect_info(Effect effect)
{
  size_t index = static_cast<size_t>(effect);
  return EFFECTS[index < EFFECT_COUNT ? index : 0];
}

bool effect_changes(const LightSettings &a, const LightSettings &b)
{
  if (a.effect != b.effect)
    return true;
  const uint16_t params = effect_info(a.effect).params;
  return ((params & PARAM_COLOR) && a.color != b.color) || ((params & PARAM_COLORS) && a.colors != b.colors) ||
         ((params & PARAM_COLOR_SET) && a.color_set != b.color_set) ||
         ((params & PARAM_HOLD) && a.hold_seconds != b.hold_seconds) ||
         ((params & PARAM_PERIOD) && a.period_seconds != b.period_seconds) ||
         ((params & PARAM_FLOOR) && a.floor != b.floor) ||
         ((params & PARAM_STRENGTH) && a.twinkle_strength != b.twinkle_strength) ||
         ((params & PARAM_TIMER) && a.timer_minutes != b.timer_minutes);
}

uint32_t xorshift32(uint32_t &state)
{
  if (state == 0)
    state = 1;
  state ^= state << 13;
  state ^= state >> 17;
  state ^= state << 5;
  return state;
}

} // namespace zenit
