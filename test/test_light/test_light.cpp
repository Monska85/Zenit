// SPDX-License-Identifier: GPL-3.0-or-later

// Unit tests of the light engine, its settings and the settings memory, beyond the conformance cases.

#include <unity.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

#include <light_record.h>

#include "app.h"
#include "output.h"
#include "platform.h"
#include "settings.h"
#include "zenit_test.h"

using zenit::Color;
using zenit::Effect;
using zenit::LightEngine;
using zenit::LightSettings;

namespace
{
// Ticks every 10 ms from `from` to `to`, both included, and returns the last frame.
zenit::LightFrame run(LightEngine &engine, uint64_t from, uint64_t to)
{
  zenit::LightFrame frame;
  for (uint64_t now = from; now <= to; now += zenit::TICK_MS)
    frame = engine.tick(now);
  return frame;
}

uint16_t white(const zenit::LightFrame &frame) { return frame.duties.value[zenit::WHITE]; }
} // namespace

void setUp()
{
  settings::keep_old_layout(false);
  platform::sim_set_log(false);
  settings::sim_fail_writes(false);
  settings::sim_clear();
  settings::sim_reset_current();
}
void tearDown() { settings::sim_fail_writes(false); }

void test_defaults_are_valid()
{
  LightSettings s;
  TEST_ASSERT_TRUE(zenit::valid(s));
  TEST_ASSERT_EQUAL(60, s.brightness);
  TEST_ASSERT_TRUE(s.effect == Effect::Static);
  TEST_ASSERT_TRUE(s.color == Color::White);
  TEST_ASSERT_EQUAL(0, s.timer_minutes);
}

void test_limits()
{
  TEST_ASSERT_FALSE(zenit::valid_brightness(0));
  TEST_ASSERT_TRUE(zenit::valid_brightness(1));
  TEST_ASSERT_TRUE(zenit::valid_brightness(100));
  TEST_ASSERT_FALSE(zenit::valid_brightness(101));
  TEST_ASSERT_FALSE(zenit::valid_hold_seconds(4));
  TEST_ASSERT_TRUE(zenit::valid_hold_seconds(600));
  TEST_ASSERT_FALSE(zenit::valid_hold_seconds(601));
  TEST_ASSERT_FALSE(zenit::valid_period_seconds(3));
  TEST_ASSERT_FALSE(zenit::valid_period_seconds(21));
  TEST_ASSERT_FALSE(zenit::valid_floor(4));
  TEST_ASSERT_FALSE(zenit::valid_floor(81));
  TEST_ASSERT_FALSE(zenit::valid_twinkle_strength(51));
  TEST_ASSERT_TRUE(zenit::valid_timer_minutes(0));
  TEST_ASSERT_TRUE(zenit::valid_timer_minutes(360));
  TEST_ASSERT_FALSE(zenit::valid_timer_minutes(361));
}

void test_color_lists()
{
  zenit::ColorList list;
  list.count = 1;
  TEST_ASSERT_FALSE(zenit::valid_colors(list));
  list.count = 2;
  list.color[0] = Color::Red;
  list.color[1] = Color::Red;
  TEST_ASSERT_FALSE(zenit::valid_colors(list));
  list.color[1] = Color::Blue;
  TEST_ASSERT_TRUE(zenit::valid_colors(list));
}

void test_text_settings()
{
  LightSettings s;
  std::string error;
  TEST_ASSERT_TRUE(zenit::set_light_setting(s, "colors", "blue,white", error));
  TEST_ASSERT_EQUAL(2, s.colors.count);
  TEST_ASSERT_FALSE(zenit::set_light_setting(s, "colors", "blue,blue", error));
  TEST_ASSERT_FALSE(zenit::set_light_setting(s, "colors", "blue,white,red,green,blue", error));
  TEST_ASSERT_FALSE(zenit::set_light_setting(s, "colors", "blue,", error));
  TEST_ASSERT_FALSE(zenit::set_light_setting(s, "brightness", "-1", error));
  TEST_ASSERT_FALSE(zenit::set_light_setting(s, "brightness", "", error));
  TEST_ASSERT_FALSE(zenit::set_light_setting(s, "effect", "rainbow", error));
  TEST_ASSERT_FALSE(zenit::set_light_setting(s, "volume", "3", error));
  TEST_ASSERT_EQUAL(2, s.colors.count); // failures change nothing
}

void test_effect_changes_follow_the_parameters_read()
{
  LightSettings a, b;
  b.hold_seconds = 99;
  TEST_ASSERT_FALSE(zenit::effect_changes(a, b)); // static does not read hold_seconds
  b.color = Color::Red;
  TEST_ASSERT_TRUE(zenit::effect_changes(a, b));
  a.effect = b.effect = Effect::ColorChange;
  b.color = a.color;
  TEST_ASSERT_TRUE(zenit::effect_changes(a, b)); // color_change reads hold_seconds
}

// The settings `info` reports for an effect are the ones whose change restarts it: each row's name is a light setting,
// and changing that setting restarts exactly the effects whose registry row reads the row's bit.
void test_effect_settings_name_the_parameters_read()
{
  uint16_t seen = 0;
  for (const zenit::EffectSetting &setting : zenit::EFFECT_SETTINGS)
  {
    TEST_ASSERT_EQUAL_UINT16(0, seen & setting.param); // each bit once
    TEST_ASSERT_NOT_EQUAL(zenit::PARAM_TIMER, setting.param);
    seen |= setting.param;
    const zenit::LightField *field = zenit::find_light_field(setting.name);
    TEST_ASSERT_NOT_NULL_MESSAGE(field, setting.name);
    for (size_t i = 0; i < zenit::EFFECT_COUNT; i++)
    {
      LightSettings a, b;
      a.effect = b.effect = static_cast<Effect>(i);
      if (field->kind == zenit::FieldKind::Number)
        TEST_ASSERT_TRUE(field->store(b, field->max, nullptr));
      else if (field->kind == zenit::FieldKind::Name)
        TEST_ASSERT_TRUE(field->store(b, 0, "red") || field->store(b, 0, "ice") || field->store(b, 0, "box"));
      else
        b.colors = zenit::color_set_colors(zenit::ColorSet::Ice);
      TEST_ASSERT_TRUE_MESSAGE(a != b, setting.name);
      const bool reads = (zenit::effect_info(a.effect).params & setting.param) != 0;
      TEST_ASSERT_EQUAL_MESSAGE(reads, zenit::effect_changes(a, b), setting.name);
    }
  }
  // Every bit a registry row reads is either a row of the table or the timer.
  for (size_t i = 0; i < zenit::EFFECT_COUNT; i++)
    TEST_ASSERT_EQUAL_UINT16(0, zenit::effect_info(static_cast<Effect>(i)).params & ~(seen | zenit::PARAM_TIMER));
}

void test_xorshift_never_sticks_at_zero()
{
  uint32_t state = 0;
  TEST_ASSERT_NOT_EQUAL(0, zenit::xorshift32(state));
}

void test_on_and_off_are_idempotent()
{
  LightEngine engine;
  engine.start(LightSettings(), 0, 1);
  run(engine, 0, 2000);
  engine.set_on(true, 2000); // already on: no fade, no restart
  TEST_ASSERT_EQUAL(4607, white(run(engine, 2000, 2100)));
  engine.set_on(false, 3000);
  run(engine, 3000, 5000);
  engine.set_on(false, 5000);
  TEST_ASSERT_EQUAL(0, white(run(engine, 5000, 5100)));
}

void test_settings_while_off_apply_at_the_next_on()
{
  LightEngine engine;
  engine.start(LightSettings(), 0, 1);
  engine.set_on(false, 1000);
  run(engine, 1000, 3000);
  LightSettings next;
  next.color = Color::Green;
  next.brightness = 100;
  engine.apply(next, 3000);
  TEST_ASSERT_EQUAL(0, run(engine, 3000, 3500).duties.value[zenit::GREEN]);
  engine.set_on(true, 4000);
  TEST_ASSERT_EQUAL(16383, run(engine, 4000, 5000).duties.value[zenit::GREEN]);
}

void test_change_back_during_fade_out_returns_without_switching()
{
  LightEngine engine;
  engine.start(LightSettings(), 0, 1);
  run(engine, 0, 2000);
  LightSettings red;
  red.color = Color::Red;
  engine.apply(red, 2000);
  run(engine, 2000, 2250);
  engine.apply(LightSettings(), 2250);
  zenit::LightFrame frame = run(engine, 2250, 3000);
  TEST_ASSERT_EQUAL(4607, white(frame));
  TEST_ASSERT_EQUAL(0, frame.duties.value[zenit::RED]);
}

void test_clearing_the_timer_during_its_fade_brings_the_light_back()
{
  LightSettings s;
  s.timer_minutes = 1;
  LightEngine engine;
  engine.start(s, 0, 1);
  run(engine, 0, 75000);
  s.timer_minutes = 0;
  engine.apply(s, 75000);
  zenit::LightFrame frame = run(engine, 75000, 80000);
  TEST_ASSERT_TRUE(frame.status.on);
  TEST_ASSERT_EQUAL(4607, white(frame));
  TEST_ASSERT_FALSE(frame.status.timer);
  TEST_ASSERT_EQUAL(4607, white(run(engine, 80000, 200000)));
}

void test_on_after_the_timer_restarts_it()
{
  LightSettings s;
  s.timer_minutes = 1;
  LightEngine engine;
  engine.start(s, 0, 1);
  TEST_ASSERT_FALSE(run(engine, 0, 90000).status.on);
  engine.set_on(true, 100000);
  zenit::LightFrame frame = run(engine, 100000, 101000);
  TEST_ASSERT_TRUE(frame.status.on);
  TEST_ASSERT_EQUAL(59, frame.status.timer_remaining_s);
}

void test_one_channel_at_a_time()
{
  for (size_t e = 0; e < zenit::EFFECT_COUNT; e++)
  {
    LightSettings s;
    s.effect = static_cast<Effect>(e);
    s.brightness = 100;
    s.hold_seconds = 5;
    s.timer_minutes = 1;
    LightEngine engine;
    engine.start(s, 0, 7);
    for (uint64_t now = 0; now <= 100000; now += zenit::TICK_MS)
    {
      zenit::LightFrame frame = engine.tick(now);
      int lit = 0;
      for (size_t c = 0; c < zenit::CHANNEL_COUNT; c++)
        lit += frame.duties.value[c] > 0;
      TEST_ASSERT_LESS_OR_EQUAL(1, lit);
    }
  }
}

void test_power_never_exceeds_the_limit()
{
  for (size_t e = 0; e < zenit::EFFECT_COUNT; e++)
  {
    LightSettings s;
    s.effect = static_cast<Effect>(e);
    s.brightness = 100;
    s.hold_seconds = 5;
    LightEngine engine;
    engine.set_power_limit(400);
    engine.start(s, 0, 3);
    for (uint64_t now = 0; now <= 60000; now += zenit::TICK_MS)
    {
      zenit::LightFrame frame = engine.tick(now);
      double mw = 0;
      for (size_t c = 0; c < zenit::CHANNEL_COUNT; c++)
        mw += static_cast<double>(frame.duties.value[c]) * zenit::FULL_SCALE_MW[c] / zenit::DUTY_MAX;
      TEST_ASSERT_TRUE(mw <= 400.0);
    }
  }
}

void test_twinkle_stays_in_range_and_follows_its_seed()
{
  LightSettings s;
  s.effect = Effect::Twinkle;
  s.twinkle_strength = 50;
  zenit::EffectState a, b;
  const zenit::EffectInfo &info = zenit::effect_info(Effect::Twinkle);
  info.reset(a, s, 42);
  info.reset(b, s, 42);
  for (uint64_t t = 0; t < 600000; t += 10)
  {
    double fa = info.at(a, s, t, zenit::TimerView()).factor;
    TEST_ASSERT_TRUE(fa >= 1000.0 - 14 * 50 && fa <= 1000.0); // a deep dip reaches 1000 - 14 * strength
    TEST_ASSERT_TRUE(fa == info.at(b, s, t, zenit::TimerView()).factor);
  }
}

void test_settings_memory_round_trip()
{
  LightSettings s;
  s.effect = Effect::Christmas;
  s.color_set = zenit::ColorSet::Ice;
  s.colors.count = 3;
  s.colors.color[0] = Color::Blue;
  s.colors.color[1] = Color::Red;
  s.colors.color[2] = Color::White;
  s.timer_minutes = 360;
  s.brightness = 1;
  settings::sim_store(s);
  settings::begin();
  TEST_ASSERT_TRUE(settings::current() == s);
}

// Stores `light` as the light part of the settings blob, followed by a board record of defaults.
void store_light_record(std::vector<uint8_t> light)
{
  uint8_t board[zenit::net::BOARD_RECORD_SIZE];
  zenit::net::BoardSettings defaults;
  std::memcpy(defaults.token, "abcdefghij012345", zenit::net::TOKEN_SIZE); // valid: the start writes nothing
  zenit::net::encode_board_record(defaults, board);
  light.insert(light.end(), board, board + sizeof(board));
  settings::sim_write_raw("settings", light);
}

void test_damaged_fields_take_their_defaults()
{
  // Version 1, brightness 0 (out of range), effect 99, color green, colors {green, green} (a repeat), timer 361.
  store_light_record({1, 0, 99, 2, 2, 2, 2, 0, 0, 0, 30, 0, 8, 20, 20, 0x69, 0x01});
  settings::begin();
  LightSettings expected;
  expected.color = Color::Green; // the one valid field that differs from the defaults
  TEST_ASSERT_TRUE(settings::current() == expected);
}

void test_a_record_of_another_size_or_version_is_ignored()
{
  store_light_record({2, 80, 1, 1, 2, 1, 2, 0, 0, 0, 30, 0, 8, 20, 20, 0, 0});
  settings::begin();
  TEST_ASSERT_TRUE(settings::current() == LightSettings());
  store_light_record({1, 80});
  settings::begin();
  TEST_ASSERT_TRUE(settings::current() == LightSettings());
}

void test_failed_commit_changes_nothing()
{
  settings::begin();
  LightSettings next;
  next.brightness = 10;
  next.color = Color::Blue;
  settings::sim_fail_writes(true);
  TEST_ASSERT_TRUE(settings::commit(next) == settings::Commit::Failed);
  settings::sim_fail_writes(false);
  TEST_ASSERT_TRUE(settings::current() == LightSettings());
  settings::begin(); // what the memory holds after a restart
  TEST_ASSERT_TRUE(settings::current() == LightSettings());
}

void test_commit_saves_every_setting_at_once()
{
  settings::begin();
  LightSettings next;
  next.brightness = 10;
  next.effect = Effect::Breathing;
  next.timer_minutes = 300;
  TEST_ASSERT_TRUE(settings::commit(next) == settings::Commit::Ok);
  settings::begin();
  TEST_ASSERT_TRUE(settings::current() == next);
}

void test_storing_the_same_settings_twice_keeps_them()
{
  LightSettings s;
  s.brightness = 33;
  settings::sim_store(s);
  settings::sim_store(s);
  settings::begin();
  TEST_ASSERT_TRUE(settings::current() == s);
}

void test_app_saves_before_it_applies()
{
  output::begin();
  settings::begin();
  app::begin(0, 1);
  app::tick(0);
  TEST_ASSERT_TRUE(app::first_output_written());
  LightSettings next;
  next.color = Color::Red;
  settings::sim_fail_writes(true);
  TEST_ASSERT_TRUE(app::change_settings(next, settings::board(), 2000) == settings::Commit::Failed);
  settings::sim_fail_writes(false);
  for (uint64_t now = 0; now <= 4000; now += zenit::TICK_MS)
    app::tick(now);
  TEST_ASSERT_EQUAL(4607, output::sim_duties().value[zenit::WHITE]);
  TEST_ASSERT_TRUE(app::change_settings(next, settings::board(), 4000) == settings::Commit::Ok);
  for (uint64_t now = 4000; now <= 6000; now += zenit::TICK_MS)
    app::tick(now);
  TEST_ASSERT_EQUAL(4607, output::sim_duties().value[zenit::RED]);
  TEST_ASSERT_FALSE(output::sim_status_led());
}

void test_registry_has_one_complete_row_per_effect()
{
  for (size_t i = 0; i < zenit::EFFECT_COUNT; i++)
  {
    const zenit::EffectInfo &info = zenit::effect_info(static_cast<Effect>(i));
    TEST_ASSERT_TRUE(info.id == static_cast<Effect>(i));
    TEST_ASSERT_NOT_NULL(info.reset);
    TEST_ASSERT_NOT_NULL(info.at);
    Effect parsed;
    TEST_ASSERT_TRUE(zenit::effect_from_name(zenit::effect_name(static_cast<Effect>(i)), parsed));
    TEST_ASSERT_TRUE(parsed == static_cast<Effect>(i));
  }
}

// The largest change of lightness between two ticks 10 ms apart that the transitions and effects can make, with
// margin: a shooting star's flash moves 4.6, twinkle at strength 50 at most 2.3, a fade of the change ramp 1.6, off and
// on 1.0 at brightness 100.
constexpr double MAX_STEP = 5.0;
// The pulses of jingle (700 in 60 ms: 11.7 at brightness 100) and the dips of hop (at most 6.3) are steeper on purpose.
constexpr double PULSE_STEP = 12.5;
bool pulses(Effect effect) { return effect == Effect::Jingle || effect == Effect::Hop; }

double lightness_at(LightEngine &engine, uint64_t now) { return engine.tick(now).status.lightness; }

void test_off_during_fall_asleep_never_brightens()
{
  LightSettings s;
  s.effect = Effect::FallAsleep;
  s.timer_minutes = 10;
  LightEngine engine;
  engine.start(s, 0, 1);
  double before = run(engine, 0, 599000).status.lightness;
  engine.set_on(false, 599000);
  for (uint64_t now = 599000; now <= 601000; now += zenit::TICK_MS)
  {
    double l = lightness_at(engine, now);
    TEST_ASSERT_TRUE(l <= before + 1e-9);
    before = l;
  }
  TEST_ASSERT_EQUAL(0, white(engine.tick(601000)));
}

void test_timer_change_during_fall_asleep_is_smooth()
{
  LightSettings s;
  s.effect = Effect::FallAsleep;
  s.timer_minutes = 10;
  LightEngine engine;
  engine.start(s, 0, 1);
  double previous = run(engine, 0, 300000).status.lightness;
  s.timer_minutes = 20;
  engine.apply(s, 300000);
  for (uint64_t now = 300000; now <= 305000; now += zenit::TICK_MS)
  {
    double l = lightness_at(engine, now);
    TEST_ASSERT_TRUE(std::fabs(l - previous) <= MAX_STEP);
    previous = l;
  }
  // The new countdown runs from the change: 20 minutes from 300 s.
  TEST_ASSERT_EQUAL(1195, engine.tick(305000).status.timer_remaining_s);
}

void test_changes_during_the_off_fade_do_not_jump()
{
  LightEngine engine;
  engine.start(LightSettings(), 0, 1);
  run(engine, 0, 5000);
  engine.set_on(false, 5000);
  double previous = run(engine, 5000, 5500).status.lightness;
  LightSettings next;
  next.color = Color::Red;
  next.brightness = 100;
  engine.apply(next, 5500);
  for (uint64_t now = 5500; now <= 7000; now += zenit::TICK_MS)
  {
    zenit::LightFrame frame = engine.tick(now);
    TEST_ASSERT_TRUE(frame.status.lightness <= previous + 1e-9);
    TEST_ASSERT_FALSE(frame.status.on);
    previous = frame.status.lightness;
  }
  TEST_ASSERT_EQUAL(0, white(engine.tick(7000)));
  engine.set_on(true, 8000);
  TEST_ASSERT_EQUAL(16383, run(engine, 8000, 9000).duties.value[zenit::RED]);
}

void test_on_during_the_off_fade_comes_back_from_the_current_output()
{
  LightEngine engine;
  engine.start(LightSettings(), 0, 1);
  run(engine, 0, 2000);
  engine.set_on(false, 2000);
  double previous = run(engine, 2000, 2500).status.lightness;
  engine.set_on(true, 2500);
  for (uint64_t now = 2500; now <= 3500; now += zenit::TICK_MS)
  {
    double l = lightness_at(engine, now);
    TEST_ASSERT_TRUE(l >= previous - 1e-9 && l - previous <= MAX_STEP);
    previous = l;
  }
  TEST_ASSERT_EQUAL(4607, white(engine.tick(3500)));
}

void test_random_events_never_jump()
{
  uint32_t random = 12345;
  for (int round = 0; round < 40; round++)
  {
    LightSettings s;
    s.effect = static_cast<Effect>(zenit::xorshift32(random) % zenit::EFFECT_COUNT);
    s.brightness = 100;
    s.hold_seconds = 5;
    s.period_seconds = 4;
    s.twinkle_strength = 50;
    s.timer_minutes = 1 + zenit::xorshift32(random) % 2;
    LightEngine engine;
    engine.start(s, 0, random);
    double previous = 0.0;
    int64_t last_pulse = -1000000; // the last tick with a pulsing effect set: its pulses may show until 1,100 ms later
    for (uint64_t now = 0; now <= 200000; now += zenit::TICK_MS)
    {
      if (zenit::xorshift32(random) % 300 == 0)
      {
        switch (zenit::xorshift32(random) % 5)
        {
        case 0:
          engine.set_on(zenit::xorshift32(random) % 2, now);
          break;
        case 1:
          s.color = static_cast<Color>(zenit::xorshift32(random) % zenit::COLOR_COUNT);
          break;
        case 2:
          s.effect = static_cast<Effect>(zenit::xorshift32(random) % zenit::EFFECT_COUNT);
          break;
        case 3:
          s.timer_minutes = zenit::xorshift32(random) % 3;
          break;
        default:
          s.brightness = 1 + zenit::xorshift32(random) % 100;
        }
        engine.apply(s, now);
      }
      zenit::LightFrame frame = engine.tick(now);
      if (pulses(s.effect))
        last_pulse = static_cast<int64_t>(now);
      // A brightness change takes 500 ms whatever its size: up to 99 over 50 ticks.
      const double limit = static_cast<int64_t>(now) - last_pulse <= 1100 ? PULSE_STEP : MAX_STEP;
      TEST_ASSERT_TRUE(std::fabs(frame.status.lightness - previous) <= limit);
      previous = frame.status.lightness;
    }
  }
}

void test_twinkle_late_ticks_compute_the_real_time()
{
  LightSettings s;
  s.effect = Effect::Twinkle;
  LightEngine regular, late;
  regular.start(s, 0, 9);
  late.start(s, 0, 9);
  run(regular, 0, 5000);
  for (uint64_t now : {0, 30, 1234, 1777, 3001, 4999})
    late.tick(now);
  TEST_ASSERT_TRUE(regular.tick(5000).duties == late.tick(5000).duties);
}

void test_on_during_the_off_fade_restarts_fall_asleep_from_full()
{
  LightSettings s;
  s.effect = Effect::FallAsleep;
  s.timer_minutes = 1;
  LightEngine engine;
  engine.start(s, 0, 1);
  run(engine, 0, 50000);
  engine.set_on(false, 50000);
  run(engine, 50000, 50500);
  engine.set_on(true, 50500);
  // A brightness change during the restart's fade-down must not cancel the restart.
  s.brightness = 61;
  engine.apply(s, 50600);
  zenit::LightFrame frame = run(engine, 50500, 53000);
  TEST_ASSERT_TRUE(frame.status.on);
  TEST_ASSERT_TRUE(frame.status.lightness > 58.0); // the new countdown has barely started: the factor is near 1000
  TEST_ASSERT_EQUAL(57, frame.status.timer_remaining_s);
}

void test_unread_parameter_during_a_fade_down_does_not_turn_it_back()
{
  LightEngine engine;
  engine.start(LightSettings(), 0, 1);
  run(engine, 0, 2000);
  LightSettings red;
  red.color = Color::Red;
  engine.apply(red, 2000);
  red.hold_seconds = 90; // static does not read it
  engine.apply(red, 2100);
  zenit::LightFrame frame = run(engine, 2000, 3000);
  TEST_ASSERT_EQUAL(4607, frame.duties.value[zenit::RED]);
}

void test_quick_turn_back_from_a_blend_does_not_jump()
{
  for (uint64_t gap : {0, 5})
  {
    LightSettings a, b, c;
    b.effect = Effect::Breathing;
    c.effect = Effect::Christmas;
    LightEngine engine;
    engine.start(a, 0, 1);
    run(engine, 0, 2000);
    engine.apply(b, 2000);
    run(engine, 2000, 3100); // 600 ms into the fade-in of breathing
    engine.apply(c, 3100);
    double previous = engine.tick(3100).status.lightness;
    for (uint64_t now = 3101; now < 3100 + gap; now++)
      previous = lightness_at(engine, now);
    engine.apply(b, 3100 + gap);
    for (uint64_t now = 3100 + gap; now <= 5000; now++)
    {
      double l = lightness_at(engine, now);
      TEST_ASSERT_TRUE(std::fabs(l - previous) <= 0.2); // a full fade-down at brightness 60 moves 0.096 per ms
      previous = l;
    }
  }
}

void test_turn_back_is_refused_when_the_effect_moved_to_another_color()
{
  LightSettings s;
  s.effect = Effect::ColorChange;
  s.colors.count = 2;
  s.colors.color[0] = Color::Red;
  s.colors.color[1] = Color::Green;
  s.hold_seconds = 5; // red until 7000, then green
  s.brightness = 100;
  LightEngine engine;
  engine.start(s, 0, 1);
  run(engine, 0, 6800);
  LightSettings other = s;
  other.hold_seconds = 6;
  engine.apply(other, 6800); // the fade-down holds red
  run(engine, 6800, 7100);
  engine.apply(s, 7100); // back, but the effect is green by now: no turn-back
  double previous = engine.tick(7100).status.lightness;
  for (uint64_t now = 7110; now <= 8000; now += zenit::TICK_MS)
  {
    zenit::LightFrame frame = engine.tick(now);
    TEST_ASSERT_TRUE(std::fabs(frame.status.lightness - previous) <= MAX_STEP);
    previous = frame.status.lightness;
    TEST_ASSERT_TRUE(frame.status.color == Color::Red); // the held red, then the restarted effect's first color
  }
}

void test_a_timer_restart_of_fall_asleep_is_never_turned_back()
{
  LightSettings s;
  s.effect = Effect::FallAsleep;
  s.timer_minutes = 1;
  LightEngine engine;
  engine.start(s, 0, 1);
  run(engine, 0, 30000);
  s.timer_minutes = 2;
  engine.apply(s, 30000);
  s.timer_minutes = 1;
  engine.apply(s, 30100); // back to one minute: still a new countdown, from 30.1 s
  zenit::LightFrame frame = run(engine, 30100, 31200);
  TEST_ASSERT_TRUE(frame.status.lightness > 58.0); // restarted from full, not the old countdown's 35
  TEST_ASSERT_EQUAL(58, frame.status.timer_remaining_s);
}

void test_twinkle_continues_its_sequence_after_a_restart()
{
  LightSettings s;
  s.effect = Effect::Twinkle;
  LightEngine engine;
  engine.start(s, 0, 1);
  // One output every 200 ms, 100 of them in the first run.
  constexpr int FIRST = 100, SECOND = 20, SHIFTS = 50;
  zenit::Duties first[FIRST];
  for (int i = 0; i < FIRST; i++)
    first[i] = engine.tick(1100 + 200 * i).duties;
  engine.set_on(false, 21000);
  run(engine, 21000, 23000);
  engine.set_on(true, 23000);
  zenit::Duties second[SECOND];
  for (int i = 0; i < SECOND; i++)
    second[i] = engine.tick(24100 + 200 * i).duties;
  // The second run is not the first one again, whatever the shift between them (a replay one segment later included).
  for (int shift = 0; shift <= SHIFTS; shift++)
  {
    int same = 0;
    for (int i = 0; i < SECOND; i++)
      same += second[i] == first[i + shift];
    TEST_ASSERT_LESS_THAN_MESSAGE(SECOND / 2, same, ("shift " + std::to_string(shift)).c_str());
  }
}

// Two doubles equal within 1e-6 (Unity's double assertions are not built).
#define NEAR(expected, actual) TEST_ASSERT_TRUE(std::fabs((expected) - (actual)) <= 1e-6)

namespace
{
// The output of `effect` with `s` from its start, sampled every tick for `duration_ms`.
struct Sample
{
  uint64_t t;
  zenit::EffectOutput out;
};
std::vector<Sample> samples(const LightSettings &s, uint32_t seed, uint64_t duration_ms)
{
  const zenit::EffectInfo &info = zenit::effect_info(s.effect);
  zenit::EffectState state;
  info.reset(state, s, seed);
  std::vector<Sample> out;
  for (uint64_t t = 0; t <= duration_ms; t += zenit::TICK_MS)
    out.push_back({t, info.at(state, s, t, zenit::TimerView())});
  return out;
}

// The most light changes in any window of 1,000 ms: each flash is two turns of F (so half the turns, rounded up), and
// each switch of color that is not at a turn counts on its own; a switch at a turn is part of that flash. `turns` and
// `switches` are sorted.
size_t most_changes_in_a_second(const std::vector<uint64_t> &turns, const std::vector<uint64_t> &switches)
{
  std::vector<uint64_t> starts = turns;
  starts.insert(starts.end(), switches.begin(), switches.end());
  size_t most = 0;
  for (uint64_t from : starts)
  {
    size_t in_turns = 0, lone = 0;
    for (uint64_t t : turns)
      in_turns += t >= from && t < from + 1000;
    for (uint64_t w : switches)
    {
      if (w < from || w >= from + 1000)
        continue;
      bool at_turn = false;
      for (uint64_t t : turns)
        at_turn = at_turn || (t + zenit::TICK_MS >= w && t <= w + zenit::TICK_MS);
      lone += !at_turn;
    }
    const size_t changes = (in_turns + 1) / 2 + lone;
    most = changes > most ? changes : most;
  }
  return most;
}

// docs/board/light-v1.md#at-most-3-light-changes-a-second: the turns of F after a swing of 100 or more (a flash is
// two), and the switches of color.
void check_three_changes_a_second(const LightSettings &s, uint32_t seed)
{
  const std::vector<Sample> run = samples(s, seed, 600000);
  std::vector<uint64_t> turns, switches;
  int direction = 0;
  double high = run[0].out.factor, low = high, extreme = high;
  uint64_t extreme_t = 0;
  for (size_t i = 1; i < run.size(); i++)
  {
    const double f = run[i].out.factor;
    const uint64_t t = run[i].t;
    if (run[i].out.color != run[i - 1].out.color)
      switches.push_back(t);
    if (direction == 0)
    {
      high = f > high ? f : high;
      low = f < low ? f : low;
      if (f - low >= 100 || high - f >= 100)
      {
        direction = f - low >= 100 ? 1 : -1;
        extreme = f;
        extreme_t = t;
      }
    }
    else if ((direction > 0 && f >= extreme) || (direction < 0 && f <= extreme))
    {
      extreme = f;
      extreme_t = t;
    }
    else if (std::fabs(f - extreme) >= 100)
    {
      turns.push_back(extreme_t);
      direction = -direction;
      extreme = f;
      extreme_t = t;
    }
  }
  const std::string label = std::string(zenit::effect_name(s.effect)) + " " + std::to_string(seed);
  TEST_ASSERT_TRUE_MESSAGE(most_changes_in_a_second(turns, switches) <= 3, label.c_str());
}
} // namespace

void test_no_effect_shows_more_than_three_changes_a_second()
{
  for (size_t e = 0; e < zenit::EFFECT_COUNT; e++)
  {
    LightSettings s;
    s.effect = static_cast<Effect>(e);
    s.hold_seconds = zenit::MIN_HOLD_SECONDS;
    s.period_seconds = zenit::MIN_PERIOD_SECONDS;
    s.twinkle_strength = zenit::MAX_TWINKLE_STRENGTH;
    s.floor = zenit::MIN_FLOOR;
    s.timer_minutes = 0;
    s.colors.count = 2;
    s.colors.color[0] = Color::Red;
    s.colors.color[1] = Color::Blue;
    for (size_t set = 0; set < zenit::COLOR_SET_COUNT; set++)
      for (size_t pattern = 0; pattern < zenit::BREATH_PATTERN_COUNT; pattern++)
        for (uint32_t seed : {1u, 7u, 123456789u})
        {
          s.color_set = static_cast<zenit::ColorSet>(set);
          s.breath_pattern = static_cast<zenit::BreathPattern>(pattern);
          check_three_changes_a_second(s, seed);
        }
  }
}

void test_color_change_switches_in_the_dark()
{
  for (Effect effect : {Effect::ColorChange, Effect::Christmas})
  {
    LightSettings s;
    s.effect = effect;
    s.floor = 80; // not read
    s.hold_seconds = 5;
    const std::vector<Sample> run = samples(s, 1, 60000);
    for (size_t i = 1; i < run.size(); i++)
      if (run[i].out.color != run[i - 1].out.color)
      {
        NEAR(10.0, run[i - 1].out.factor); // 10 ms before the switch
        NEAR(0.0, run[i].out.factor);
        TEST_ASSERT_EQUAL_UINT64(0, run[i].t % 7000);
      }
  }
}

void test_breathing_repeats_after_1961_periods()
{
  LightSettings s;
  s.effect = Effect::Breathing;
  s.period_seconds = 4;
  zenit::EffectState state;
  const zenit::EffectInfo &info = zenit::effect_info(Effect::Breathing);
  const uint64_t whole = 1961ull * 4000;
  for (uint64_t t : {0ull, 1234ull, 2000ull, 777777ull})
  {
    const double near = info.at(state, s, t, zenit::TimerView()).factor;
    const double far = info.at(state, s, t + 3 * whole, zenit::TimerView()).factor;
    NEAR(near, far);
    TEST_ASSERT_TRUE(near >= 200.0 - 1e-9 && near <= 1000.0);
  }
  // A cycle of the slow waves, computed without the remainder, agrees with the effect
  for (uint64_t t = 0; t < 200000; t += 970)
  {
    const double a = t / 4000.0;
    const double phase = 2 * M_PI * a + 0.45 * std::sin(2 * M_PI * a / 3.7);
    const double depth = 0.86 + 0.14 * std::sin(2 * M_PI * a / 5.3 + 1.1);
    NEAR(200.0 + 800.0 * depth * (1 + std::cos(phase)) / 2, info.at(state, s, t, zenit::TimerView()).factor);
  }
}

void test_shooting_star_flashes_every_10_to_60_seconds()
{
  LightSettings s;
  s.effect = Effect::ShootingStar;
  const zenit::EffectInfo &info = zenit::effect_info(Effect::ShootingStar);
  for (uint32_t seed : {1u, 2u, 99u, 4000000000u})
  {
    zenit::EffectState state;
    info.reset(state, s, seed);
    std::vector<uint64_t> flashes;
    for (uint64_t t = 0; t <= 3600000; t += zenit::TICK_MS)
    {
      const zenit::EffectOutput out = info.at(state, s, t, zenit::TimerView());
      TEST_ASSERT_TRUE(out.factor >= 450.0 && out.factor <= 1000.0);
      TEST_ASSERT_TRUE(out.color == Color::White);
      if (state.flashed && (flashes.empty() || flashes.back() != state.start))
        flashes.push_back(state.start);
    }
    TEST_ASSERT_TRUE(flashes.size() >= 3600 / 60);
    TEST_ASSERT_TRUE(flashes[0] >= 10000 && flashes[0] <= 60000);
    for (size_t i = 1; i < flashes.size(); i++)
      TEST_ASSERT_TRUE(flashes[i] - flashes[i - 1] >= 10000 && flashes[i] - flashes[i - 1] <= 60000);
    // The first flash, at the millisecond: sky before it, full 120 ms after its start
    zenit::EffectState exact;
    info.reset(exact, s, seed);
    NEAR(450.0, info.at(exact, s, flashes[0] - 1, zenit::TimerView()).factor);
    NEAR(450.0, info.at(exact, s, flashes[0], zenit::TimerView()).factor);
    NEAR(1000.0, info.at(exact, s, flashes[0] + 120, zenit::TimerView()).factor);
  }
}

void test_guided_breathing_follows_its_pattern()
{
  LightSettings s;
  s.effect = Effect::GuidedBreathing;
  s.floor = 20;
  const zenit::EffectInfo &info = zenit::effect_info(Effect::GuidedBreathing);
  zenit::EffectState state;
  auto f = [&](uint64_t t)
  {
    return info.at(state, s, t, zenit::TimerView()).factor;
  };
  // 4-7-8: in 0 to 4 s, full to 11 s, out to 19 s, then again
  NEAR(200.0, f(0));
  NEAR(600.0, f(2000));
  for (uint64_t t = 4000; t < 11000; t += 500)
    NEAR(1000.0, f(t));
  NEAR(600.0, f(15000));
  NEAR(200.0, f(19000));
  s.breath_pattern = zenit::BreathPattern::Box;
  NEAR(1000.0, f(6000));
  NEAR(600.0, f(10000));
  for (uint64_t t = 12000; t < 16000; t += 500)
    NEAR(200.0, f(t));
  NEAR(200.0, f(16000));
  NEAR(600.0, f(18000));
}

void test_jingle_gives_each_note_the_next_color()
{
  LightSettings s;
  s.effect = Effect::Jingle;
  s.color_set = zenit::ColorSet::All;
  const zenit::EffectInfo &info = zenit::effect_info(Effect::Jingle);
  zenit::EffectState state;
  const uint64_t starts[] = {0, 600, 1200, 2400, 3000, 3600, 4800, 5400, 6000, 6600, 7200};
  const zenit::ColorList all = zenit::color_set_colors(zenit::ColorSet::All);
  for (uint64_t cycle = 0; cycle < 3; cycle++)
    for (size_t k = 0; k < 11; k++)
    {
      const uint64_t t = cycle * 12000 + starts[k];
      const zenit::EffectOutput at_start = info.at(state, s, t, zenit::TimerView());
      NEAR(300.0, at_start.factor);
      TEST_ASSERT_TRUE(at_start.color == all.color[(cycle * 11 + k) % 4]);
      NEAR(1000.0, info.at(state, s, t + 60, zenit::TimerView()).factor);
    }
  // The long note decays through the rest: no step at its start (9,600)
  const double before = info.at(state, s, 9590, zenit::TimerView()).factor;
  const double after = info.at(state, s, 9600, zenit::TimerView()).factor;
  TEST_ASSERT_TRUE(before > after && before - after < 1.0);
}

void test_hop_never_shows_the_same_color_twice_in_a_row()
{
  for (size_t set = 0; set < zenit::COLOR_SET_COUNT; set++)
  {
    LightSettings s;
    s.effect = Effect::Hop;
    s.color_set = static_cast<zenit::ColorSet>(set);
    const zenit::ColorList palette = zenit::color_set_colors(s.color_set);
    const std::vector<Sample> run = samples(s, 5, 700 * 2000);
    size_t seen[zenit::COLOR_COUNT] = {};
    for (size_t hop = 1; hop < 2000; hop++)
    {
      const Color previous = run[(hop * 700 - 10) / 10].out.color;
      const Color now = run[hop * 70].out.color;
      TEST_ASSERT_TRUE(previous != now);
      NEAR(400.0, run[hop * 70].out.factor);
      seen[static_cast<size_t>(now)]++;
    }
    for (size_t i = 0; i < palette.count; i++)
      TEST_ASSERT_TRUE(seen[static_cast<size_t>(palette.color[i])] > 2000 / palette.count / 2);
  }
}

void test_new_effects_draw_from_the_one_sequence()
{
  // The same seed repeats; the first color of hop is the first draw of the sequence; shooting star's first wait too
  LightSettings s;
  s.effect = Effect::Hop;
  s.color_set = zenit::ColorSet::All;
  zenit::EffectState a, b;
  const zenit::EffectInfo &info = zenit::effect_info(Effect::Hop);
  info.reset(a, s, 42);
  info.reset(b, s, 42);
  for (uint64_t t = 0; t < 100000; t += 10)
    TEST_ASSERT_TRUE(info.at(a, s, t, zenit::TimerView()).color == info.at(b, s, t, zenit::TimerView()).color);
  uint32_t random = 42;
  const uint32_t first = zenit::xorshift32(random);
  zenit::EffectState c;
  info.reset(c, s, 42);
  TEST_ASSERT_TRUE(info.at(c, s, 0, zenit::TimerView()).color == zenit::color_set_colors(s.color_set).color[first % 4]);
  TEST_ASSERT_EQUAL_UINT32(random, c.random);
  zenit::EffectState star;
  zenit::effect_info(Effect::ShootingStar).reset(star, s, 42);
  TEST_ASSERT_EQUAL_UINT64(10000 + first % 50001, star.until);
}

void test_a_version_1_record_keeps_every_value()
{
  // Firmware 1.1.0: christmas, ice, brightness 80, colors blue, red; hold 600, period 20, floor 5, strength 50, timer 1
  store_light_record({1, 80, 5, 3, 2, 3, 1, 0, 0, 1, 0x58, 0x02, 20, 5, 50, 1, 0});
  TEST_ASSERT_EQUAL_size_t(17 + zenit::net::BOARD_RECORD_SIZE, settings::sim_read_raw("settings").size());
  settings::begin();
  LightSettings expected;
  expected.brightness = 80;
  expected.effect = Effect::Christmas;
  expected.color = Color::Blue;
  expected.colors.count = 2;
  expected.colors.color[0] = Color::Blue;
  expected.colors.color[1] = Color::Red;
  expected.color_set = zenit::ColorSet::Ice;
  expected.hold_seconds = 600;
  expected.period_seconds = 20;
  expected.floor = 5;
  expected.twinkle_strength = 50;
  expected.timer_minutes = 1;
  TEST_ASSERT_TRUE(settings::current() == expected);
  TEST_ASSERT_TRUE(settings::current().breath_pattern == zenit::BreathPattern::FourSevenEight);
  // Reading writes nothing; the next save writes version 2
  TEST_ASSERT_EQUAL_size_t(17 + zenit::net::BOARD_RECORD_SIZE, settings::sim_read_raw("settings").size());
  LightSettings next = expected;
  next.breath_pattern = zenit::BreathPattern::Box;
  TEST_ASSERT_TRUE(settings::commit(next) == settings::Commit::Ok);
  const std::vector<uint8_t> blob = settings::sim_read_raw("settings");
  TEST_ASSERT_EQUAL_size_t(18 + zenit::net::BOARD_RECORD_SIZE, blob.size());
  TEST_ASSERT_EQUAL_UINT8(2, blob[0]);
  TEST_ASSERT_EQUAL_UINT8(1, blob[17]);
  settings::begin();
  TEST_ASSERT_TRUE(settings::current() == next);
}

void test_a_new_token_keeps_a_version_1_blob_in_version_1()
{
  // A version 1 blob whose token is damaged: the start writes the new token, in the layout the previous firmware reads
  std::vector<uint8_t> blob = {1, 80, 2, 0, 4, 1, 2, 3, 0, 0, 30, 0, 8, 20, 20, 0, 0};
  uint8_t board[zenit::net::BOARD_RECORD_SIZE];
  zenit::net::encode_board_record(zenit::net::BoardSettings(), board); // no token
  blob.insert(blob.end(), board, board + sizeof(board));
  settings::sim_write_raw("settings", blob);
  settings::begin();
  TEST_ASSERT_TRUE(zenit::net::valid_token(settings::board().token));
  const std::vector<uint8_t> written = settings::sim_read_raw("settings");
  TEST_ASSERT_EQUAL_size_t(17 + zenit::net::BOARD_RECORD_SIZE, written.size());
  TEST_ASSERT_EQUAL_UINT8(1, written[0]);
  TEST_ASSERT_TRUE(std::equal(blob.begin() + 1, blob.begin() + 17, written.begin() + 1));
  LightSettings expected;
  expected.brightness = 80;
  expected.effect = Effect::Breathing;
  TEST_ASSERT_TRUE(settings::current() == expected);
  // Read again: the same settings and token
  const std::string token = settings::board().token;
  settings::begin();
  TEST_ASSERT_TRUE(settings::current() == expected);
  TEST_ASSERT_EQUAL_STRING(token.c_str(), settings::board().token);
}

void test_on_trial_a_version_1_blob_stays_version_1()
{
  store_light_record({1, 80, 2, 0, 4, 1, 2, 3, 0, 0, 30, 0, 8, 20, 20, 0, 0});
  settings::begin();
  settings::keep_old_layout(true); // a firmware on trial: the previous one may boot again
  LightSettings next = settings::current();
  next.brightness = 40;
  TEST_ASSERT_TRUE(settings::commit(next) == settings::Commit::Ok);
  std::vector<uint8_t> blob = settings::sim_read_raw("settings");
  TEST_ASSERT_EQUAL_size_t(17 + zenit::net::BOARD_RECORD_SIZE, blob.size());
  TEST_ASSERT_EQUAL_UINT8(1, blob[0]);
  TEST_ASSERT_EQUAL_UINT8(40, blob[1]);
  // A pattern version 1 cannot hold: version 2
  next.breath_pattern = zenit::BreathPattern::Box;
  TEST_ASSERT_TRUE(settings::commit(next) == settings::Commit::Ok);
  blob = settings::sim_read_raw("settings");
  TEST_ASSERT_EQUAL_size_t(18 + zenit::net::BOARD_RECORD_SIZE, blob.size());
  // Confirmed: every save writes version 2
  store_light_record({1, 80, 2, 0, 4, 1, 2, 3, 0, 0, 30, 0, 8, 20, 20, 0, 0});
  settings::begin();
  settings::keep_old_layout(false);
  next = settings::current();
  next.brightness = 41;
  TEST_ASSERT_TRUE(settings::commit(next) == settings::Commit::Ok);
  blob = settings::sim_read_raw("settings");
  TEST_ASSERT_EQUAL_size_t(18 + zenit::net::BOARD_RECORD_SIZE, blob.size());
  TEST_ASSERT_EQUAL_UINT8(2, blob[0]);
  settings::begin();
  TEST_ASSERT_EQUAL_UINT8(41, settings::current().brightness);
}

void test_a_blob_whose_size_does_not_match_its_version_is_damaged()
{
  // Version 1 bytes in a 273-byte blob, and version 2 bytes in a 272-byte blob: defaults
  store_light_record({1, 80, 2, 0, 4, 1, 2, 3, 0, 0, 30, 0, 8, 20, 20, 0, 0, 0});
  settings::begin();
  TEST_ASSERT_TRUE(settings::current() == LightSettings());
  store_light_record({2, 80, 2, 0, 4, 1, 2, 3, 0, 0, 30, 0, 8, 20, 20, 0, 0});
  settings::begin();
  TEST_ASSERT_TRUE(settings::current() == LightSettings());
  // Version 2 with every new code
  store_light_record({2, 80, 9, 0, 4, 1, 2, 3, 0, 4, 30, 0, 8, 20, 20, 0, 0, 1});
  settings::begin();
  TEST_ASSERT_TRUE(settings::current().effect == Effect::Hop);
  TEST_ASSERT_TRUE(settings::current().color_set == zenit::ColorSet::All);
  TEST_ASSERT_TRUE(settings::current().breath_pattern == zenit::BreathPattern::Box);
  TEST_ASSERT_EQUAL_UINT8(80, settings::current().brightness);
  // A blob longer than any record is damaged, whatever its first byte
  store_light_record({2, 80, 9, 0, 4, 1, 2, 3, 0, 4, 30, 0, 8, 20, 20, 0, 0, 1, 0});
  settings::begin();
  TEST_ASSERT_TRUE(settings::current() == LightSettings());
  // The helper alone: a size that fits no record is 0 before the version byte is looked at
  const uint8_t one = 2;
  TEST_ASSERT_EQUAL_size_t(0, zenit::light_record_size_in_blob(&one, 274, 255));
  TEST_ASSERT_EQUAL_size_t(18, zenit::light_record_size_in_blob(&one, 273, 255));
  // A pattern code out of range keeps its default
  store_light_record({2, 80, 7, 0, 4, 1, 2, 3, 0, 4, 30, 0, 8, 20, 20, 0, 0, 2});
  settings::begin();
  TEST_ASSERT_TRUE(settings::current().effect == Effect::GuidedBreathing);
  TEST_ASSERT_TRUE(settings::current().breath_pattern == zenit::BreathPattern::FourSevenEight);
}

int main()
{
  UNITY_BEGIN();
  RUN_TEST(test_defaults_are_valid);
  RUN_TEST(test_limits);
  RUN_TEST(test_color_lists);
  RUN_TEST(test_text_settings);
  RUN_TEST(test_effect_changes_follow_the_parameters_read);
  RUN_TEST(test_effect_settings_name_the_parameters_read);
  RUN_TEST(test_xorshift_never_sticks_at_zero);
  RUN_TEST(test_on_and_off_are_idempotent);
  RUN_TEST(test_settings_while_off_apply_at_the_next_on);
  RUN_TEST(test_change_back_during_fade_out_returns_without_switching);
  RUN_TEST(test_clearing_the_timer_during_its_fade_brings_the_light_back);
  RUN_TEST(test_on_after_the_timer_restarts_it);
  RUN_TEST(test_one_channel_at_a_time);
  RUN_TEST(test_power_never_exceeds_the_limit);
  RUN_TEST(test_twinkle_stays_in_range_and_follows_its_seed);
  RUN_TEST(test_settings_memory_round_trip);
  RUN_TEST(test_damaged_fields_take_their_defaults);
  RUN_TEST(test_a_record_of_another_size_or_version_is_ignored);
  RUN_TEST(test_failed_commit_changes_nothing);
  RUN_TEST(test_commit_saves_every_setting_at_once);
  RUN_TEST(test_storing_the_same_settings_twice_keeps_them);
  RUN_TEST(test_app_saves_before_it_applies);
  RUN_TEST(test_registry_has_one_complete_row_per_effect);
  RUN_TEST(test_off_during_fall_asleep_never_brightens);
  RUN_TEST(test_timer_change_during_fall_asleep_is_smooth);
  RUN_TEST(test_changes_during_the_off_fade_do_not_jump);
  RUN_TEST(test_on_during_the_off_fade_comes_back_from_the_current_output);
  RUN_TEST(test_random_events_never_jump);
  RUN_TEST(test_twinkle_late_ticks_compute_the_real_time);
  RUN_TEST(test_on_during_the_off_fade_restarts_fall_asleep_from_full);
  RUN_TEST(test_unread_parameter_during_a_fade_down_does_not_turn_it_back);
  RUN_TEST(test_quick_turn_back_from_a_blend_does_not_jump);
  RUN_TEST(test_turn_back_is_refused_when_the_effect_moved_to_another_color);
  RUN_TEST(test_a_timer_restart_of_fall_asleep_is_never_turned_back);
  RUN_TEST(test_twinkle_continues_its_sequence_after_a_restart);
  RUN_TEST(test_no_effect_shows_more_than_three_changes_a_second);
  RUN_TEST(test_color_change_switches_in_the_dark);
  RUN_TEST(test_breathing_repeats_after_1961_periods);
  RUN_TEST(test_shooting_star_flashes_every_10_to_60_seconds);
  RUN_TEST(test_guided_breathing_follows_its_pattern);
  RUN_TEST(test_jingle_gives_each_note_the_next_color);
  RUN_TEST(test_hop_never_shows_the_same_color_twice_in_a_row);
  RUN_TEST(test_new_effects_draw_from_the_one_sequence);
  RUN_TEST(test_a_version_1_record_keeps_every_value);
  RUN_TEST(test_a_new_token_keeps_a_version_1_blob_in_version_1);
  RUN_TEST(test_on_trial_a_version_1_blob_stays_version_1);
  RUN_TEST(test_a_blob_whose_size_does_not_match_its_version_is_damaged);
  return UNITY_END();
}
