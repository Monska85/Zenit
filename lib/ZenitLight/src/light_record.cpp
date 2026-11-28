// SPDX-License-Identifier: GPL-3.0-or-later

#include "light_record.h"

namespace zenit
{

// The stored codes never change meaning (docs/board/light-v1.md#stored-settings).
static_assert(static_cast<int>(Effect::Static) == 0 && static_cast<int>(Effect::ColorChange) == 1 &&
                  static_cast<int>(Effect::Breathing) == 2 && static_cast<int>(Effect::Twinkle) == 3 &&
                  static_cast<int>(Effect::FallAsleep) == 4 && static_cast<int>(Effect::Christmas) == 5 &&
                  static_cast<int>(Effect::ShootingStar) == 6 && static_cast<int>(Effect::GuidedBreathing) == 7 &&
                  static_cast<int>(Effect::Jingle) == 8 && static_cast<int>(Effect::Hop) == 9,
              "effect codes are stored");
static_assert(static_cast<int>(Color::White) == 0 && static_cast<int>(Color::Red) == 1 &&
                  static_cast<int>(Color::Green) == 2 && static_cast<int>(Color::Blue) == 3,
              "color codes are stored");
static_assert(static_cast<int>(ColorSet::Christmas) == 0 && static_cast<int>(ColorSet::Ice) == 1 &&
                  static_cast<int>(ColorSet::Aurora) == 2 && static_cast<int>(ColorSet::Sunset) == 3 &&
                  static_cast<int>(ColorSet::All) == 4,
              "color set codes are stored");
static_assert(static_cast<int>(BreathPattern::FourSevenEight) == 0 && static_cast<int>(BreathPattern::Box) == 1,
              "pattern codes are stored");

void encode_light_record(const LightSettings &s, uint8_t (&out)[LIGHT_RECORD_SIZE])
{
  out[0] = LIGHT_RECORD_VERSION;
  out[1] = s.brightness;
  out[2] = static_cast<uint8_t>(s.effect);
  out[3] = static_cast<uint8_t>(s.color);
  out[4] = s.colors.count;
  for (size_t i = 0; i < MAX_COLORS; i++)
    out[5 + i] = i < s.colors.count ? static_cast<uint8_t>(s.colors.color[i]) : 0;
  out[9] = static_cast<uint8_t>(s.color_set);
  out[10] = s.hold_seconds & 0xFF;
  out[11] = s.hold_seconds >> 8;
  out[12] = s.period_seconds;
  out[13] = s.floor;
  out[14] = s.twinkle_strength;
  out[15] = s.timer_minutes & 0xFF;
  out[16] = s.timer_minutes >> 8;
  out[17] = static_cast<uint8_t>(s.breath_pattern);
}

LightSettings decode_light_record(const uint8_t *in, size_t size)
{
  LightSettings s;
  if (!in ||
      !((size == LIGHT_RECORD_SIZE && in[0] == LIGHT_RECORD_VERSION) || (size == LIGHT_RECORD_V1_SIZE && in[0] == 1)))
    return s;
  if (valid_brightness(in[1]))
    s.brightness = in[1];
  if (in[2] < EFFECT_COUNT)
    s.effect = static_cast<Effect>(in[2]);
  if (in[3] < COLOR_COUNT)
    s.color = static_cast<Color>(in[3]);
  ColorList colors;
  colors.count = in[4];
  bool colors_ok = colors.count <= MAX_COLORS;
  for (size_t i = 0; colors_ok && i < colors.count; i++)
  {
    colors_ok = in[5 + i] < COLOR_COUNT;
    colors.color[i] = static_cast<Color>(in[5 + i]);
  }
  if (colors_ok && valid_colors(colors))
    s.colors = colors;
  if (in[9] < COLOR_SET_COUNT)
    s.color_set = static_cast<ColorSet>(in[9]);
  const uint16_t hold = in[10] | (in[11] << 8);
  if (valid_hold_seconds(hold))
    s.hold_seconds = hold;
  if (valid_period_seconds(in[12]))
    s.period_seconds = in[12];
  if (valid_floor(in[13]))
    s.floor = in[13];
  if (valid_twinkle_strength(in[14]))
    s.twinkle_strength = in[14];
  const uint16_t timer = in[15] | (in[16] << 8);
  if (valid_timer_minutes(timer))
    s.timer_minutes = timer;
  if (size == LIGHT_RECORD_SIZE && in[17] < BREATH_PATTERN_COUNT)
    s.breath_pattern = static_cast<BreathPattern>(in[17]);
  return s;
}

bool light_record_is_current(const uint8_t *in, size_t size)
{
  return in && size == LIGHT_RECORD_SIZE && in[0] == LIGHT_RECORD_VERSION && in[2] < EFFECT_COUNT;
}

size_t light_record_size_in_blob(const uint8_t *blob, size_t size, size_t other_size)
{
  // The size first: a blob of another size may not have been read into `blob` at all
  if (!blob)
    return 0;
  if (size == LIGHT_RECORD_SIZE + other_size && blob[0] == LIGHT_RECORD_VERSION)
    return LIGHT_RECORD_SIZE;
  if (size == LIGHT_RECORD_V1_SIZE + other_size && blob[0] == 1)
    return LIGHT_RECORD_V1_SIZE;
  return 0;
}

} // namespace zenit
