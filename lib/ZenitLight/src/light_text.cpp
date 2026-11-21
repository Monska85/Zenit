// SPDX-License-Identifier: GPL-3.0-or-later

#include "light_text.h"

#include <cstdlib>

namespace zenit
{

namespace
{
bool parse_number(const std::string &text, uint32_t &out)
{
  if (text.empty() || text.size() > 6)
    return false;
  for (char c : text)
    if (c < '0' || c > '9')
      return false;
  out = static_cast<uint32_t>(std::strtoul(text.c_str(), nullptr, 10));
  return true;
}
} // namespace

bool set_light_setting(LightSettings &settings, const std::string &key, const std::string &value, std::string &error)
{
  LightSettings next = settings;
  uint32_t number = 0;
  bool numeric = parse_number(value, number);
  bool ok = false;
  if (key == "brightness")
    ok = numeric && valid_brightness(number) && (next.brightness = number, true);
  else if (key == "effect")
    ok = effect_from_name(value.c_str(), next.effect);
  else if (key == "color")
    ok = color_from_name(value.c_str(), next.color);
  else if (key == "colors")
  {
    ColorList list;
    list.count = 0;
    size_t start = 0;
    ok = true;
    while (ok)
    {
      size_t comma = value.find(',', start);
      std::string name = value.substr(start, comma == std::string::npos ? std::string::npos : comma - start);
      ok = list.count < MAX_COLORS && color_from_name(name.c_str(), list.color[list.count]);
      if (ok)
        list.count++;
      if (comma == std::string::npos)
        break;
      start = comma + 1;
    }
    ok = ok && valid_colors(list);
    if (ok)
      next.colors = list;
  }
  else if (key == "color_set")
    ok = color_set_from_name(value.c_str(), next.color_set);
  else if (key == "hold_seconds")
    ok = numeric && valid_hold_seconds(number) && (next.hold_seconds = number, true);
  else if (key == "period_seconds")
    ok = numeric && valid_period_seconds(number) && (next.period_seconds = number, true);
  else if (key == "floor")
    ok = numeric && valid_floor(number) && (next.floor = number, true);
  else if (key == "twinkle_strength")
    ok = numeric && valid_twinkle_strength(number) && (next.twinkle_strength = number, true);
  else if (key == "timer_minutes")
    ok = numeric && valid_timer_minutes(number) && (next.timer_minutes = number, true);
  else
  {
    error = "unknown setting '" + key + "'";
    return false;
  }
  if (!ok)
  {
    error = "invalid value '" + value + "' for " + key;
    return false;
  }
  settings = next;
  return true;
}

} // namespace zenit
