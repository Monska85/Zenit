// SPDX-License-Identifier: GPL-3.0-or-later

#include "engine.h"

#include <cmath>

#include "curve.h"

namespace zenit
{

double Ramp::at(uint64_t now) const
{
  if (duration == 0 || now >= start + duration)
    return to;
  if (now <= start)
    return from;
  return from + (to - from) * static_cast<double>(now - start) / duration;
}

void Ramp::run(double from_value, double to_value, uint64_t start_ms, uint64_t duration_ms)
{
  from = from_value;
  to = to_value;
  start = start_ms;
  duration = duration_ms;
}

void Ramp::retarget(double target, uint64_t now, double ms_per_unit)
{
  const double current = at(now);
  run(current, target, now, static_cast<uint64_t>(std::llround(std::fabs(target - current) * ms_per_unit)));
}

void LightEngine::start(const LightSettings &settings, uint64_t now, uint32_t seed)
{
  // The one random sequence of the engine starts at the seed; each effect start continues it (start_effect).
  effect_state_ = EffectState();
  effect_state_.random = seed;
  target_ = shown_ = settings;
  light_ = Light::On;
  brightness_.set(settings.brightness, now);
  change_state_ = Change::Idle;
  power_.set(0.0, now);
  power_.retarget(1.0, now, POWER_MS);
  timer_.set(1.0, now);
  start_timer(now);
  start_effect(now);
}

void LightEngine::start_effect(uint64_t at)
{
  effect_start_ = at;
  // The random sequence goes on where the effect that ends left it: twinkle draws from it, the other effects leave it
  // as it was, so a new start never replays draws of an earlier one.
  const uint32_t random = effect_state_.random;
  effect_state_ = EffectState();
  effect_state_.random = random;
  // The effect keeps the countdown it started with, so a later timer change reaches it only through a transition.
  effect_timer_ = TimerView();
  effect_timer_.running = timer_state_ != Timer::None;
  effect_timer_.duration_ms = timer_duration_;
  effect_timer_start_ = timer_start_;
  effect_info(shown_.effect).reset(effect_state_, shown_, random);
}

void LightEngine::start_timer(uint64_t at)
{
  timer_start_ = at;
  timer_duration_ = static_cast<uint64_t>(target_.timer_minutes) * 60000;
  timer_state_ = timer_duration_ > 0 ? Timer::Running : Timer::None;
}

double LightEngine::effect_factor(uint64_t now, Color *color)
{
  const uint64_t t = now > effect_start_ ? now - effect_start_ : 0;
  TimerView timer = effect_timer_;
  timer.elapsed_ms = now > effect_timer_start_ ? now - effect_timer_start_ : 0;
  const EffectOutput out = effect_info(shown_.effect).at(effect_state_, shown_, t, timer);
  if (color)
    *color = out.color;
  return out.factor;
}

double LightEngine::shown_factor(uint64_t now, Color *color)
{
  const double own = effect_factor(now, color);
  if (change_state_ == Change::Idle || change_duration_ == 0)
    return own;
  const double u =
      now >= change_start_ + change_duration_ ? 1.0 : static_cast<double>(now - change_start_) / change_duration_;
  if (change_state_ == Change::FadingOut)
  {
    if (color)
      *color = change_color_;
    return change_level_ * (1.0 - (1.0 - CHANGE_FLOOR) * u);
  }
  return change_level_ + (own - change_level_) * u;
}

void LightEngine::begin_change(uint64_t now, bool forced)
{
  if (change_state_ == Change::FadingOut)
  {
    change_forced_ = change_forced_ || forced;
    return;
  }
  change_level_ = shown_factor(now, &change_color_);
  change_state_ = Change::FadingOut;
  change_forced_ = forced;
  change_start_ = now;
  change_duration_ = CHANGE_MS;
}

void LightEngine::turn_back(uint64_t now)
{
  const double level = shown_factor(now); // the factor shown now, in the held color
  // Back to the effect's own factor at the rate of a full fade-down: from a fade-down that started at the effect's
  // own level, that is the time it has taken so far.
  const double own = effect_factor(now);
  change_duration_ =
      static_cast<uint64_t>(std::llround(std::fabs(own - level) / (1000.0 * (1.0 - CHANGE_FLOOR)) * CHANGE_MS));
  change_level_ = level;
  change_start_ = now;
  change_state_ = Change::FadingIn;
}

void LightEngine::finish_fade_out(uint64_t at)
{
  // The blend starts from the level the fade-down reached.
  change_level_ *= CHANGE_FLOOR;
  shown_ = target_;
  start_effect(at);
  change_state_ = Change::FadingIn;
  change_forced_ = false;
  change_start_ = at;
  change_duration_ = CHANGE_MS;
}

void LightEngine::restart_timer(uint64_t now)
{
  start_timer(now);
  // A timer that was fading out comes back up, and an effect that follows the countdown restarts with the new one.
  timer_.retarget(1.0, now, POWER_MS);
  if (effect_info(shown_.effect).params & PARAM_TIMER)
    begin_change(now, true);
}

void LightEngine::apply(const LightSettings &settings, uint64_t now)
{
  advance(now);
  const LightSettings previous = target_;
  target_ = settings;

  if (light_ == Light::Off)
  {
    // Nothing shows: the next light on starts from these settings.
    shown_ = settings;
    brightness_.set(settings.brightness, now);
    change_state_ = Change::Idle;
    return;
  }

  // Lit, or fading off: every change goes through its transition.
  if (settings.brightness != previous.brightness)
    brightness_.run(brightness_.at(now), settings.brightness, now, BRIGHTNESS_MS);

  if (settings.timer_minutes != previous.timer_minutes && light_ == Light::On)
    restart_timer(now);

  if (effect_changes(shown_, settings))
    begin_change(now, false);
  else if (change_state_ != Change::FadingOut)
    // A parameter the running effect does not read: nothing changes on the light.
    shown_ = settings;
  else if (!change_forced_)
  {
    // A change back to the running effect during the fade-down. It turns back from where it is, in the time the
    // fade-down has taken so far, unless the running effect has moved to another color meanwhile: then the fade-down
    // goes on and the effect starts again, so the color never switches at a high level.
    Color own;
    effect_factor(now, &own);
    if (own == change_color_)
    {
      turn_back(now);
      shown_ = settings;
    }
  }
}

void LightEngine::set_on(bool on, uint64_t now)
{
  advance(now);
  if (!on)
  {
    if (light_ == Light::On)
    {
      // The level left by a timer fade-out becomes the start of the off fade, at the rate of a full fade.
      power_.set(power_.at(now) * timer_.at(now), now);
      timer_.set(1.0, now);
      timer_state_ = Timer::None;
      light_ = Light::FadingOff;
      power_.retarget(0.0, now, POWER_MS);
    }
    return;
  }
  if (light_ == Light::On)
  {
    // On during the timer's fade-out brings the light back with a new countdown.
    if (timer_state_ == Timer::Fading)
      restart_timer(now);
    return;
  }

  const bool was_off = light_ == Light::Off;
  light_ = Light::On;
  power_.retarget(1.0, now, POWER_MS);
  if (was_off)
  {
    start_timer(now);
    timer_.set(1.0, now);
    shown_ = target_;
    brightness_.set(target_.brightness, now);
    change_state_ = Change::Idle;
    start_effect(now);
  }
  else
    // Back on during the off fade: from the current level, with a new countdown.
    restart_timer(now);
}

void LightEngine::advance(uint64_t now)
{
  // An effect change: once faded out, the new effect starts at the end of the fade, at the floor, and fades in.
  if (change_state_ == Change::FadingOut && now >= change_start_ + change_duration_)
    finish_fade_out(change_start_ + change_duration_);
  if (change_state_ == Change::FadingIn && now >= change_start_ + change_duration_)
    change_state_ = Change::Idle;

  // The timer: at its end the light fades out over TIMER_FADE_MS, then it is off.
  if (light_ == Light::On && timer_state_ == Timer::Running && now >= timer_end())
  {
    timer_state_ = Timer::Fading;
    timer_.run(timer_.at(timer_end()), 0.0, timer_end(), TIMER_FADE_MS);
  }
  if (light_ == Light::On && timer_state_ == Timer::Fading && timer_.done(now))
  {
    light_ = Light::Off;
    power_.set(0.0, now);
    timer_.set(1.0, now);
  }

  // Off from the app: once faded out, it is off.
  if (light_ == Light::FadingOff && power_.done(now))
    light_ = Light::Off;
}

LightFrame LightEngine::tick(uint64_t now)
{
  advance(now);
  LightFrame frame;
  Color color = Color::White;
  const double factor = shown_factor(now, &color);

  double lightness = 0.0;
  if (light_ != Light::Off)
    lightness = brightness_.at(now) * factor / 1000.0 * power_.at(now) * timer_.at(now);
  if (lightness < 0.0)
    lightness = 0.0;
  if (lightness > 100.0)
    lightness = 100.0;

  const Channel channel = channel_of(color);
  frame.duties.value[channel] = lightness_to_duty(lightness);
  frame.status.power_scale = apply_power_limit(frame.duties, limit_mw_);

  LightStatus &s = frame.status;
  s.on = light_ == Light::On;
  s.effect = target_.effect;
  s.lit = frame.duties.value[channel] > 0;
  s.color = color;
  s.lightness = lightness;
  s.timer = target_.timer_minutes > 0;
  s.timer_minutes = target_.timer_minutes;
  if (light_ == Light::On && timer_state_ == Timer::Running && timer_end() > now)
    s.timer_remaining_s = static_cast<uint32_t>((timer_end() - now) / 1000);
  return frame;
}

} // namespace zenit
