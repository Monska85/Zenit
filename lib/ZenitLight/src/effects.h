// SPDX-License-Identifier: GPL-3.0-or-later

// The effects of docs/board/light-v1.md#effects. Each effect is one class with two static functions, listed in one
// registry table (effects.cpp). Adding an effect: its value in Effect and its name (light_settings), its class
// declaration here and its definition in its own file, a row in the table, its specification and its conformance
// cases. A new setting an effect reads also needs a bit in EffectParam and a line in effect_changes().

#pragma once

#include <cstdint>

#include "light_settings.h"
#include "light_types.h"

namespace zenit
{

// What an effect shows at one moment: a color and a factor from 0 to 1,000 (per mille of the brightness).
struct EffectOutput
{
  Color color = Color::White;
  double factor = 1000.0;
};

// The countdown as an effect sees it: the one that was running when the effect started.
struct TimerView
{
  bool running = false;     // a countdown was set when the effect started
  uint64_t elapsed_ms = 0;  // since the countdown started
  uint64_t duration_ms = 0; // the whole countdown
};

// What an effect keeps between ticks. Only `twinkle` needs it; the others are pure functions of time.
struct EffectState
{
  uint32_t random = 1;
  uint64_t segment = 0;
  double from = 1000.0;
  double to = 1000.0;
};

// The settings an effect reads, as a bit mask: a change of one of them restarts the effect with a transition.
enum EffectParam : uint16_t
{
  PARAM_COLOR = 1 << 0,
  PARAM_COLORS = 1 << 1,
  PARAM_COLOR_SET = 1 << 2,
  PARAM_HOLD = 1 << 3,
  PARAM_PERIOD = 1 << 4,
  PARAM_FLOOR = 1 << 5,
  PARAM_STRENGTH = 1 << 6,
  PARAM_TIMER = 1 << 7 // the effect follows the countdown: a timer change restarts it with a transition
};

struct EffectInfo
{
  Effect id;
  uint16_t params;
  // Called when the effect starts, at t = 0, with the seed of the random sequence.
  void (*reset)(EffectState &state, const LightSettings &settings, uint32_t seed);
  // The output `t_ms` after the effect started. `t_ms` never decreases between two calls after a reset.
  EffectOutput (*at)(EffectState &state, const LightSettings &settings, uint64_t t_ms, const TimerView &timer);
};

const EffectInfo &effect_info(Effect effect);

// Whether a change from `a` to `b` restarts the effect: another effect, or a parameter it reads.
bool effect_changes(const LightSettings &a, const LightSettings &b);

// The 32-bit xorshift step of `twinkle`. A zero state is replaced by 1.
uint32_t xorshift32(uint32_t &state);

class StaticEffect
{
public:
  static void reset(EffectState &, const LightSettings &, uint32_t) {}
  static EffectOutput at(EffectState &, const LightSettings &settings, uint64_t, const TimerView &);
};

class ColorChangeEffect
{
public:
  static void reset(EffectState &, const LightSettings &, uint32_t) {}
  static EffectOutput at(EffectState &, const LightSettings &settings, uint64_t t_ms, const TimerView &);
  // The cycle shared with `christmas`.
  static EffectOutput cycle(const ColorList &colors, uint16_t hold_seconds, uint8_t floor, uint64_t t_ms);
};

class BreathingEffect
{
public:
  static void reset(EffectState &, const LightSettings &, uint32_t) {}
  static EffectOutput at(EffectState &, const LightSettings &settings, uint64_t t_ms, const TimerView &);
};

class TwinkleEffect
{
public:
  static constexpr uint32_t SEGMENT_MS = 200;
  static void reset(EffectState &state, const LightSettings &settings, uint32_t seed);
  static EffectOutput at(EffectState &state, const LightSettings &settings, uint64_t t_ms, const TimerView &);
};

class FallAsleepEffect
{
public:
  static void reset(EffectState &, const LightSettings &, uint32_t) {}
  static EffectOutput at(EffectState &, const LightSettings &settings, uint64_t, const TimerView &timer);
};

class ChristmasEffect
{
public:
  static void reset(EffectState &, const LightSettings &, uint32_t) {}
  static EffectOutput at(EffectState &, const LightSettings &settings, uint64_t t_ms, const TimerView &);
};

} // namespace zenit
