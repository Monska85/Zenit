// SPDX-License-Identifier: GPL-3.0-or-later

#include "settings_json.h"

#include <cstdio>
#include <cstring>

namespace zenit
{
namespace proto
{

namespace
{

// A whole number in [low, high]. ArduinoJson stores 60.0 and 6e1 as floats, which are not whole numbers here.
bool read_integer(JsonVariantConst value, uint32_t low, uint32_t high, uint32_t &out)
{
  if (!value.is<int64_t>())
    return false;
  const int64_t number = value.as<int64_t>();
  if (number < static_cast<int64_t>(low) || number > static_cast<int64_t>(high))
    return false;
  out = static_cast<uint32_t>(number);
  return true;
}

Failure bad_value(const char *name, const char *why)
{
  Failure failure = fail_field("bad_request", "invalid value for", name);
  const size_t used = std::strlen(failure.message);
  std::snprintf(failure.message + used, sizeof(failure.message) - used, ": %s", why);
  return failure;
}

Failure read_colors(JsonVariantConst value, ColorList &list)
{
  if (!value.is<JsonArrayConst>())
    return bad_value("colors", "expected an array of colors");
  JsonArrayConst array = value.as<JsonArrayConst>();
  if (array.size() < MIN_COLORS || array.size() > MAX_COLORS)
    return bad_value("colors", "expected 2 to 4 colors");
  ColorList result;
  result.count = 0;
  for (JsonVariantConst item : array)
  {
    Color color;
    if (!item.is<const char *>() || !color_from_name(item.as<const char *>(), color))
      return bad_value("colors", "not a color the board can light");
    result.color[result.count++] = color;
  }
  if (!valid_colors(result))
    return bad_value("colors", "a color is listed twice");
  list = result;
  return {};
}

} // namespace

Failure apply_settings_request(JsonObjectConst request, LightSettings &settings)
{
  LightSettings next = settings;
  bool any = false;
  for (JsonPairConst field : request)
  {
    const char *name = field.key().c_str();
    JsonVariantConst value = field.value();
    if (std::strcmp(name, "seq") == 0 || std::strcmp(name, "cmd") == 0)
      continue;
    any = true;
    uint32_t number = 0;
    if (std::strcmp(name, "brightness") == 0)
    {
      if (!read_integer(value, MIN_BRIGHTNESS, MAX_BRIGHTNESS, number))
        return bad_value(name, "expected a whole number from 1 to 100");
      next.brightness = static_cast<uint8_t>(number);
    }
    else if (std::strcmp(name, "effect") == 0)
    {
      if (!value.is<const char *>() || !effect_from_name(value.as<const char *>(), next.effect))
        return bad_value(name, "not an effect of the board");
    }
    else if (std::strcmp(name, "color") == 0)
    {
      if (!value.is<const char *>() || !color_from_name(value.as<const char *>(), next.color))
        return bad_value(name, "not a color the board can light");
    }
    else if (std::strcmp(name, "colors") == 0)
    {
      if (Failure failure = read_colors(value, next.colors))
        return failure;
    }
    else if (std::strcmp(name, "color_set") == 0)
    {
      if (!value.is<const char *>() || !color_set_from_name(value.as<const char *>(), next.color_set))
        return bad_value(name, "not a color set of the board");
    }
    else if (std::strcmp(name, "hold_seconds") == 0)
    {
      if (!read_integer(value, MIN_HOLD_SECONDS, MAX_HOLD_SECONDS, number))
        return bad_value(name, "expected a whole number from 5 to 600");
      next.hold_seconds = static_cast<uint16_t>(number);
    }
    else if (std::strcmp(name, "period_seconds") == 0)
    {
      if (!read_integer(value, MIN_PERIOD_SECONDS, MAX_PERIOD_SECONDS, number))
        return bad_value(name, "expected a whole number from 4 to 20");
      next.period_seconds = static_cast<uint8_t>(number);
    }
    else if (std::strcmp(name, "floor") == 0)
    {
      if (!read_integer(value, MIN_FLOOR, MAX_FLOOR, number))
        return bad_value(name, "expected a whole number from 5 to 80");
      next.floor = static_cast<uint8_t>(number);
    }
    else if (std::strcmp(name, "twinkle_strength") == 0)
    {
      if (!read_integer(value, MIN_TWINKLE_STRENGTH, MAX_TWINKLE_STRENGTH, number))
        return bad_value(name, "expected a whole number from 5 to 50");
      next.twinkle_strength = static_cast<uint8_t>(number);
    }
    else if (std::strcmp(name, "timer_minutes") == 0)
    {
      if (!read_integer(value, 0, MAX_TIMER_MINUTES, number))
        return bad_value(name, "expected a whole number from 0 to 360");
      next.timer_minutes = static_cast<uint16_t>(number);
    }
    else
      return fail_field("bad_request", "unknown field", name);
  }
  if (!any)
    return fail("bad_request", "settings_set needs at least one setting");
  settings = next;
  return {};
}

void write_settings(JsonObject target, const LightSettings &s)
{
  target["brightness"] = s.brightness;
  target["effect"] = effect_name(s.effect);
  target["color"] = color_name(s.color);
  JsonArray colors = target["colors"].to<JsonArray>();
  for (size_t i = 0; i < s.colors.count && i < MAX_COLORS; i++)
    colors.add(color_name(s.colors.color[i]));
  target["color_set"] = color_set_name(s.color_set);
  target["hold_seconds"] = s.hold_seconds;
  target["period_seconds"] = s.period_seconds;
  target["floor"] = s.floor;
  target["twinkle_strength"] = s.twinkle_strength;
  target["timer_minutes"] = s.timer_minutes;
}

} // namespace proto
} // namespace zenit
