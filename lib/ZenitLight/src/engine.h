// SPDX-License-Identifier: GPL-3.0-or-later

// The light engine: settings and time in, the four duties and the light status out
// (docs/board/light-v1.md). It reads no clock of its own: every call takes the time in milliseconds from a monotonic
// clock that never goes back, so the board, the simulator and the tests run the same code.

#pragma once

#include <cstdint>

#include "effects.h"
#include "light_settings.h"
#include "light_types.h"

namespace zenit
{

struct LightStatus
{
  bool on = false;
  Effect effect = Effect::Static;
  bool lit = false; // a channel has a duty above 0
  Color color = Color::White;
  double lightness = 0.0;
  uint8_t power_scale = 100;
  bool timer = false; // a timer is set
  uint16_t timer_minutes = 0;
  uint32_t timer_remaining_s = 0; // whole seconds until the fade-out starts, 0 after it
};

struct LightFrame
{
  Duties duties;
  LightStatus status;
};

// A linear ramp of one value, from `from` at `start` to `to` at `start + duration`.
struct Ramp
{
  double from = 1.0;
  double to = 1.0;
  uint64_t start = 0;
  uint64_t duration = 0;

  double at(uint64_t now) const;
  bool done(uint64_t now) const { return now >= start + duration; }
  // A ramp with every field given.
  void run(double from_value, double to_value, uint64_t start_ms, uint64_t duration_ms);
  // From the value at `now` to `target`, at the rate of a full change of 1.0 in `ms_per_unit`: a partial change takes
  // the matching part of the time (docs/board/light-v1.md#transitions).
  void retarget(double target, uint64_t now, double ms_per_unit);
  void set(double value, uint64_t now) { run(value, value, now, 0); }
};

class LightEngine
{
public:
  static constexpr uint32_t BRIGHTNESS_MS = 500; // a brightness change, whatever its size
  static constexpr double CHANGE_FLOOR = 0.2;    // effect changes go down to 20 %
  static constexpr uint32_t CHANGE_MS = 500;     // from full to the floor, and back
  static constexpr uint32_t POWER_MS = 1000;     // light on and off, from off to full
  static constexpr uint32_t TIMER_FADE_MS = 30000;

  // Starts the light: from off, fading in to `settings` over POWER_MS, with the timer. `seed` seeds `twinkle`.
  void start(const LightSettings &settings, uint64_t now, uint32_t seed);
  // New settings, with the transitions of the specification. The settings must be valid.
  void apply(const LightSettings &settings, uint64_t now);
  // On fades in and restarts the timer; off fades out. Nothing changes when already in that state.
  void set_on(bool on, uint64_t now);
  // The outputs at `now`.
  LightFrame tick(uint64_t now);

  const LightSettings &settings() const { return target_; }
  // For tests: a power limit other than POWER_LIMIT_MW.
  void set_power_limit(uint32_t limit_mw) { limit_mw_ = limit_mw; }

private:
  enum class Light
  {
    On,
    FadingOff, // off from the app: reported off, still fading to 0
    Off
  };
  enum class Change
  {
    Idle,
    FadingOut,
    FadingIn
  };
  enum class Timer
  {
    None,
    Running,
    Fading // the countdown ended: the 30 s fade-out runs
  };

  void start_effect(uint64_t at);
  void start_timer(uint64_t at);
  // Starts the fade-down of an effect change. `forced`: a restart of the running effect (a new countdown), which no
  // change back can cancel.
  void begin_change(uint64_t now, bool forced);
  void turn_back(uint64_t now);
  void finish_fade_out(uint64_t at);
  void restart_timer(uint64_t now);
  void advance(uint64_t now);
  // The running effect's own factor at `now`.
  double effect_factor(uint64_t now, Color *color = nullptr);
  // The factor shown at `now`: the effect's own, or the transition between two effects.
  double shown_factor(uint64_t now, Color *color = nullptr);
  uint64_t timer_end() const { return timer_start_ + timer_duration_; }

  LightSettings target_; // the latest settings
  LightSettings shown_;  // the settings of the running effect
  EffectState effect_state_;
  uint64_t effect_start_ = 0;
  TimerView effect_timer_; // the countdown when the effect started, with elapsed counted from effect_timer_start_
  uint64_t effect_timer_start_ = 0;
  uint32_t limit_mw_ = POWER_LIMIT_MW;

  Light light_ = Light::Off;
  Ramp brightness_;
  // An effect change, over change_start_ and change_duration_. FadingOut shows the held color (change_color_) and takes
  // the held factor (change_level_) down to CHANGE_FLOOR of itself. When it ends, change_level_ becomes the level it
  // reached, and FadingIn moves from there to the running effect's own factor, in the effect's own color. A turn-back
  // goes to FadingIn from the level shown at that moment.
  Change change_state_ = Change::Idle;
  bool change_forced_ = false;
  double change_level_ = 1000.0;
  Color change_color_ = Color::White; // the color held while FadingOut
  uint64_t change_start_ = 0;
  uint64_t change_duration_ = 0;
  Ramp power_;

  Timer timer_state_ = Timer::None;
  uint64_t timer_start_ = 0;
  uint64_t timer_duration_ = 0;
  Ramp timer_;
};

} // namespace zenit
