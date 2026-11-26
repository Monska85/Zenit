// SPDX-License-Identifier: GPL-3.0-or-later

// The light settings of docs/protocol/protocol-v1.md#settings_get-settings_set, with their defaults and limits.

#pragma once

#include <cstddef>
#include <cstdint>

#include "light_types.h"

namespace zenit
{

enum class Effect : uint8_t
{
  Static,
  ColorChange,
  Breathing,
  Twinkle,
  FallAsleep,
  Christmas
};
constexpr size_t EFFECT_COUNT = 6;

enum class ColorSet : uint8_t
{
  Christmas,
  Ice
};
constexpr size_t COLOR_SET_COUNT = 2;

constexpr uint8_t MIN_BRIGHTNESS = 1;
constexpr uint8_t MAX_BRIGHTNESS = 100;
constexpr size_t MIN_COLORS = 2;
constexpr size_t MAX_COLORS = 4;
constexpr uint16_t MIN_HOLD_SECONDS = 5;
constexpr uint16_t MAX_HOLD_SECONDS = 600;
constexpr uint8_t MIN_PERIOD_SECONDS = 4;
constexpr uint8_t MAX_PERIOD_SECONDS = 20;
constexpr uint8_t MIN_FLOOR = 5;
constexpr uint8_t MAX_FLOOR = 80;
constexpr uint8_t MIN_TWINKLE_STRENGTH = 5;
constexpr uint8_t MAX_TWINKLE_STRENGTH = 50;
constexpr uint16_t MAX_TIMER_MINUTES = 360;

// The colors of a list setting: `count` valid entries of `color`.
struct ColorList
{
  Color color[MAX_COLORS] = {Color::Red, Color::Green, Color::Blue, Color::White};
  uint8_t count = 4;
  bool operator==(const ColorList &other) const;
  bool operator!=(const ColorList &other) const { return !(*this == other); }
};

struct LightSettings
{
  uint8_t brightness = 60;
  Effect effect = Effect::Static;
  Color color = Color::White;
  ColorList colors;
  ColorSet color_set = ColorSet::Christmas;
  uint16_t hold_seconds = 30;
  uint8_t period_seconds = 8;
  uint8_t floor = 20;
  uint8_t twinkle_strength = 20;
  uint16_t timer_minutes = 0; // 0: no timer

  bool operator==(const LightSettings &other) const;
  bool operator!=(const LightSettings &other) const { return !(*this == other); }
};

bool valid_brightness(uint32_t value);
bool valid_colors(const ColorList &colors);
bool valid_hold_seconds(uint32_t value);
bool valid_period_seconds(uint32_t value);
bool valid_floor(uint32_t value);
bool valid_twinkle_strength(uint32_t value);
bool valid_timer_minutes(uint32_t value);
// Every field in its range.
bool valid(const LightSettings &settings);

const char *effect_name(Effect effect);
bool effect_from_name(const char *name, Effect &effect);
const char *color_set_name(ColorSet set);
bool color_set_from_name(const char *name, ColorSet &set);
// The colors of a preset list of the `christmas` effect.
ColorList color_set_colors(ColorSet set);

// The light settings as the readers of a request see them (the protocol's JSON and the simulator's `key=value` text):
// one row per setting, in the order of the protocol's table, so both readers check the same names and ranges.
enum class FieldKind : uint8_t
{
  Number, // a whole number from `min` to `max`
  Name,   // one of the names of an enumeration: an effect, a color or a color set
  Colors  // a list of `MIN_COLORS` to `MAX_COLORS` colors, each listed once (valid_colors)
};
struct LightField
{
  const char *name;
  FieldKind kind;
  uint32_t min;
  uint32_t max;
  // Name: what a reply says of a name that is not one of the values.
  const char *refused;
  // Number: stores `number`, already in range. Name: stores the value named `text`; false when no value has that name.
  // Colors: not used (the readers build the list and store it in `colors`).
  bool (*store)(LightSettings &settings, uint32_t number, const char *text);
};
// The row of the setting `name`, or nullptr when no light setting has that name.
const LightField *find_light_field(const char *name);

} // namespace zenit
