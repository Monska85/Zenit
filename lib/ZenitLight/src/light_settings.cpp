// SPDX-License-Identifier: GPL-3.0-or-later

#include "light_settings.h"

#include <cstring>

namespace zenit
{

namespace
{
const char *const EFFECT_NAMES[EFFECT_COUNT] = {"static",  "color_change", "breathing",
                                                "twinkle", "fall_asleep",  "christmas"};
const char *const COLOR_SET_NAMES[COLOR_SET_COUNT] = {"christmas", "ice"};

const LightField LIGHT_FIELDS[] = {
    {"brightness", FieldKind::Number, MIN_BRIGHTNESS, MAX_BRIGHTNESS, nullptr,
     [](LightSettings &s, uint32_t n, const char *)
     {
       s.brightness = static_cast<uint8_t>(n);
       return true;
     }},
    {"effect", FieldKind::Name, 0, 0, "not an effect of the board",
     [](LightSettings &s, uint32_t, const char *text)
     {
       return effect_from_name(text, s.effect);
     }},
    {"color", FieldKind::Name, 0, 0, "not a color the board can light",
     [](LightSettings &s, uint32_t, const char *text)
     {
       return color_from_name(text, s.color);
     }},
    {"colors", FieldKind::Colors, MIN_COLORS, MAX_COLORS, nullptr, nullptr},
    {"color_set", FieldKind::Name, 0, 0, "not a color set of the board",
     [](LightSettings &s, uint32_t, const char *text)
     {
       return color_set_from_name(text, s.color_set);
     }},
    {"hold_seconds", FieldKind::Number, MIN_HOLD_SECONDS, MAX_HOLD_SECONDS, nullptr,
     [](LightSettings &s, uint32_t n, const char *)
     {
       s.hold_seconds = static_cast<uint16_t>(n);
       return true;
     }},
    {"period_seconds", FieldKind::Number, MIN_PERIOD_SECONDS, MAX_PERIOD_SECONDS, nullptr,
     [](LightSettings &s, uint32_t n, const char *)
     {
       s.period_seconds = static_cast<uint8_t>(n);
       return true;
     }},
    {"floor", FieldKind::Number, MIN_FLOOR, MAX_FLOOR, nullptr,
     [](LightSettings &s, uint32_t n, const char *)
     {
       s.floor = static_cast<uint8_t>(n);
       return true;
     }},
    {"twinkle_strength", FieldKind::Number, MIN_TWINKLE_STRENGTH, MAX_TWINKLE_STRENGTH, nullptr,
     [](LightSettings &s, uint32_t n, const char *)
     {
       s.twinkle_strength = static_cast<uint8_t>(n);
       return true;
     }},
    {"timer_minutes", FieldKind::Number, 0, MAX_TIMER_MINUTES, nullptr,
     [](LightSettings &s, uint32_t n, const char *)
     {
       s.timer_minutes = static_cast<uint16_t>(n);
       return true;
     }},
};
} // namespace

const LightField *find_light_field(const char *name)
{
  for (const LightField &field : LIGHT_FIELDS)
    if (std::strcmp(name, field.name) == 0)
      return &field;
  return nullptr;
}

bool ColorList::operator==(const ColorList &other) const
{
  if (count != other.count)
    return false;
  for (size_t i = 0; i < count && i < MAX_COLORS; i++)
    if (color[i] != other.color[i])
      return false;
  return true;
}

bool LightSettings::operator==(const LightSettings &other) const
{
  return brightness == other.brightness && effect == other.effect && color == other.color && colors == other.colors &&
         color_set == other.color_set && hold_seconds == other.hold_seconds && period_seconds == other.period_seconds &&
         floor == other.floor && twinkle_strength == other.twinkle_strength && timer_minutes == other.timer_minutes;
}

bool valid_brightness(uint32_t value) { return value >= MIN_BRIGHTNESS && value <= MAX_BRIGHTNESS; }

bool valid_colors(const ColorList &colors)
{
  if (colors.count < MIN_COLORS || colors.count > MAX_COLORS)
    return false;
  for (size_t i = 0; i < colors.count; i++)
  {
    if (static_cast<size_t>(colors.color[i]) >= COLOR_COUNT)
      return false;
    for (size_t j = 0; j < i; j++)
      if (colors.color[i] == colors.color[j])
        return false;
  }
  return true;
}

bool valid_hold_seconds(uint32_t value) { return value >= MIN_HOLD_SECONDS && value <= MAX_HOLD_SECONDS; }
bool valid_period_seconds(uint32_t value) { return value >= MIN_PERIOD_SECONDS && value <= MAX_PERIOD_SECONDS; }
bool valid_floor(uint32_t value) { return value >= MIN_FLOOR && value <= MAX_FLOOR; }
bool valid_twinkle_strength(uint32_t value) { return value >= MIN_TWINKLE_STRENGTH && value <= MAX_TWINKLE_STRENGTH; }
bool valid_timer_minutes(uint32_t value) { return value <= MAX_TIMER_MINUTES; }

bool valid(const LightSettings &s)
{
  return valid_brightness(s.brightness) && static_cast<size_t>(s.effect) < EFFECT_COUNT &&
         static_cast<size_t>(s.color) < COLOR_COUNT && valid_colors(s.colors) &&
         static_cast<size_t>(s.color_set) < COLOR_SET_COUNT && valid_hold_seconds(s.hold_seconds) &&
         valid_period_seconds(s.period_seconds) && valid_floor(s.floor) && valid_twinkle_strength(s.twinkle_strength) &&
         valid_timer_minutes(s.timer_minutes);
}

const char *effect_name(Effect effect)
{
  size_t index = static_cast<size_t>(effect);
  return index < EFFECT_COUNT ? EFFECT_NAMES[index] : "static";
}

bool effect_from_name(const char *name, Effect &effect)
{
  if (!name)
    return false;
  for (size_t i = 0; i < EFFECT_COUNT; i++)
    if (std::strcmp(name, EFFECT_NAMES[i]) == 0)
    {
      effect = static_cast<Effect>(i);
      return true;
    }
  return false;
}

const char *color_set_name(ColorSet set)
{
  size_t index = static_cast<size_t>(set);
  return index < COLOR_SET_COUNT ? COLOR_SET_NAMES[index] : "christmas";
}

bool color_set_from_name(const char *name, ColorSet &set)
{
  if (!name)
    return false;
  for (size_t i = 0; i < COLOR_SET_COUNT; i++)
    if (std::strcmp(name, COLOR_SET_NAMES[i]) == 0)
    {
      set = static_cast<ColorSet>(i);
      return true;
    }
  return false;
}

ColorList color_set_colors(ColorSet set)
{
  ColorList list;
  if (set == ColorSet::Ice)
  {
    list.color[0] = Color::Blue;
    list.color[1] = Color::White;
    list.count = 2;
  }
  else
  {
    list.color[0] = Color::Red;
    list.color[1] = Color::Green;
    list.color[2] = Color::White;
    list.count = 3;
  }
  return list;
}

} // namespace zenit
