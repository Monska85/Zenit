// SPDX-License-Identifier: GPL-3.0-or-later

// Unit tests of the light engine, its settings and the settings memory, beyond the conformance cases.

#include <unity.h>

#include <cmath>
#include <string>

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
    TEST_ASSERT_TRUE(fa >= 500.0 && fa <= 1000.0);
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

void test_damaged_fields_take_their_defaults()
{
  // Version 1, brightness 0 (out of range), effect 99, color green, colors {green, green} (a repeat), timer 361.
  settings::sim_write_raw("light", {1, 0, 99, 2, 2, 2, 2, 0, 0, 0, 30, 0, 8, 20, 20, 0x69, 0x01});
  settings::begin();
  LightSettings expected;
  expected.color = Color::Green; // the one valid field that differs from the defaults
  TEST_ASSERT_TRUE(settings::current() == expected);
}

void test_a_record_of_another_size_or_version_is_ignored()
{
  settings::sim_write_raw("light", {2, 80, 1, 1, 2, 1, 2, 0, 0, 0, 30, 0, 8, 20, 20, 0, 0});
  settings::begin();
  TEST_ASSERT_TRUE(settings::current() == LightSettings());
  settings::sim_write_raw("light", {1, 80});
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
  TEST_ASSERT_TRUE(app::change_settings(next, 2000) == settings::Commit::Failed);
  settings::sim_fail_writes(false);
  for (uint64_t now = 0; now <= 4000; now += zenit::TICK_MS)
    app::tick(now);
  TEST_ASSERT_EQUAL(4607, output::sim_duties().value[zenit::WHITE]);
  TEST_ASSERT_TRUE(app::change_settings(next, 4000) == settings::Commit::Ok);
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
// margin: twinkle at strength 50 moves 2.5, a fade of the change ramp 1.6, off and on 1.0 at brightness 100.
constexpr double MAX_STEP = 5.0;

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
      // A brightness change takes 500 ms whatever its size: up to 99 over 50 ticks.
      TEST_ASSERT_TRUE(std::fabs(frame.status.lightness - previous) <= MAX_STEP);
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
  other.floor = 30;
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
  zenit::Duties first[20];
  for (int i = 0; i < 20; i++)
    first[i] = engine.tick(1000 + 200 * i).duties;
  engine.set_on(false, 5000);
  run(engine, 5000, 7000);
  engine.set_on(true, 7000);
  int same = 0;
  for (int i = 0; i < 20; i++)
    same += engine.tick(8000 + 200 * i).duties == first[i];
  TEST_ASSERT_LESS_THAN(20, same);
}

int main()
{
  UNITY_BEGIN();
  RUN_TEST(test_defaults_are_valid);
  RUN_TEST(test_limits);
  RUN_TEST(test_color_lists);
  RUN_TEST(test_text_settings);
  RUN_TEST(test_effect_changes_follow_the_parameters_read);
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
  return UNITY_END();
}
