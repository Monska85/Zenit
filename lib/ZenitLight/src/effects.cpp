// SPDX-License-Identifier: GPL-3.0-or-later

#include "effects.h"

#include <cmath>

namespace zenit
{

namespace
{
// The registry, in the order of Effect.
const EffectInfo EFFECTS[EFFECT_COUNT] = {
    {Effect::Static, PARAM_COLOR, StaticEffect::reset, StaticEffect::at},
    {Effect::ColorChange, PARAM_COLORS | PARAM_HOLD, ColorChangeEffect::reset, ColorChangeEffect::at},
    {Effect::Breathing, PARAM_COLOR | PARAM_PERIOD | PARAM_FLOOR, BreathingEffect::reset, BreathingEffect::at},
    {Effect::Twinkle, PARAM_COLOR | PARAM_STRENGTH, TwinkleEffect::reset, TwinkleEffect::at},
    {Effect::FallAsleep, PARAM_COLOR | PARAM_FLOOR | PARAM_TIMER, FallAsleepEffect::reset, FallAsleepEffect::at},
    {Effect::Christmas, PARAM_COLOR_SET | PARAM_HOLD, ChristmasEffect::reset, ChristmasEffect::at},
    {Effect::ShootingStar, PARAM_COLOR, ShootingStarEffect::reset, ShootingStarEffect::at},
    {Effect::GuidedBreathing, PARAM_COLOR | PARAM_PATTERN | PARAM_FLOOR, GuidedBreathingEffect::reset,
     GuidedBreathingEffect::at},
    {Effect::Jingle, PARAM_COLOR_SET, JingleEffect::reset, JingleEffect::at},
    {Effect::Hop, PARAM_COLOR_SET, HopEffect::reset, HopEffect::at},
};
static_assert(sizeof(EFFECTS) / sizeof(EFFECTS[0]) == EFFECT_COUNT, "one registry row per effect");
} // namespace

const EffectSetting EFFECT_SETTINGS[EFFECT_SETTING_COUNT] = {
    {PARAM_COLOR, "color"},           {PARAM_COLORS, "colors"},
    {PARAM_COLOR_SET, "color_set"},   {PARAM_HOLD, "hold_seconds"},
    {PARAM_PERIOD, "period_seconds"}, {PARAM_PATTERN, "breath_pattern"},
    {PARAM_FLOOR, "floor"},           {PARAM_STRENGTH, "twinkle_strength"},
};

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
         ((params & PARAM_PATTERN) && a.breath_pattern != b.breath_pattern) ||
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

double ease(double p)
{
  if (p <= 0.0)
    return 0.0;
  if (p >= 1.0)
    return 1.0;
  return (1.0 - std::cos(M_PI * p)) / 2.0;
}

} // namespace zenit
