// SPDX-License-Identifier: GPL-3.0-or-later

#include "settings_json.h"

#include <cstdio>
#include <string>
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
  {
    char why[32];
    std::snprintf(why, sizeof(why), "expected %u to %u colors", static_cast<unsigned>(MIN_COLORS),
                  static_cast<unsigned>(MAX_COLORS));
    return bad_value("colors", why);
  }
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

// One light setting of a request, checked by its row of the light-field table.
Failure apply_light_field(const LightField &field, JsonVariantConst value, LightSettings &next)
{
  if (field.kind == FieldKind::Colors)
    return read_colors(value, next.colors);
  if (field.kind == FieldKind::Name)
  {
    if (!value.is<const char *>() || !field.store(next, 0, value.as<const char *>()))
      return bad_value(field.name, field.refused);
    return {};
  }
  uint32_t number = 0;
  if (!read_integer(value, field.min, field.max, number))
  {
    char why[48];
    std::snprintf(why, sizeof(why), "expected a whole number from %u to %u", static_cast<unsigned>(field.min),
                  static_cast<unsigned>(field.max));
    return bad_value(field.name, why);
  }
  field.store(next, number, "");
  return {};
}

} // namespace

// The board settings fields; `handled` is false when `name` is not one of them.
Failure apply_board_field(const char *name, JsonVariantConst value, net::BoardSettings &next, bool &handled)
{
  handled = true;
  uint32_t number = 0;
  if (std::strcmp(name, "wifi_power") == 0)
  {
    if (!value.is<const char *>() || !net::wifi_power_from_name(value.as<const char *>(), next.wifi_power))
      return bad_value(name, "expected auto, 8.5, 11, 13, 15, 17, 18.5 or 19.5");
  }
  else if (std::strcmp(name, "update_mode") == 0)
  {
    if (!value.is<const char *>() || !net::update_mode_from_name(value.as<const char *>(), next.update_mode))
      return bad_value(name, "expected off, notify or automatic");
  }
  else if (std::strcmp(name, "update_firmware") == 0)
  {
    if (!value.is<bool>())
      return bad_value(name, "expected true or false");
    next.update_firmware = value.as<bool>();
  }
  else if (std::strcmp(name, "update_web") == 0)
  {
    if (!value.is<bool>())
      return bad_value(name, "expected true or false");
    next.update_web = value.as<bool>();
  }
  else if (std::strcmp(name, "check_hours") == 0)
  {
    if (!read_integer(value, 1, 168, number))
      return bad_value(name, "expected a whole number from 1 to 168");
    next.check_hours = static_cast<uint8_t>(number);
  }
  else if (std::strcmp(name, "install_start") == 0)
  {
    if (!read_integer(value, 0, net::MINUTES_PER_DAY - 1, number))
      return bad_value(name, "expected a whole number from 0 to 1439");
    next.install_start = static_cast<uint16_t>(number);
  }
  else if (std::strcmp(name, "install_end") == 0)
  {
    if (!read_integer(value, 0, net::MINUTES_PER_DAY - 1, number))
      return bad_value(name, "expected a whole number from 0 to 1439");
    next.install_end = static_cast<uint16_t>(number);
  }
  else if (std::strcmp(name, "timezone") == 0)
  {
    if (!value.is<const char *>() || !net::valid_timezone(value.as<const char *>()))
      return bad_value(name, "expected 1 to 64 printable characters without spaces");
    std::strcpy(next.timezone, value.as<const char *>());
  }
  else if (std::strcmp(name, "time_sync_hours") == 0)
  {
    if (!read_integer(value, 1, 168, number))
      return bad_value(name, "expected a whole number from 1 to 168");
    next.time_sync_hours = static_cast<uint8_t>(number);
  }
  else if (std::strcmp(name, "ntp_server") == 0)
  {
    if (!value.is<const char *>() || !net::valid_ntp_server(value.as<const char *>()))
      return bad_value(name, "expected a host name or address of 1 to 64 letters, digits, dots and hyphens");
    std::strcpy(next.ntp_server, value.as<const char *>());
  }
  else if (std::strcmp(name, "network_login") == 0)
  {
    if (!value.is<bool>())
      return bad_value(name, "expected true or false");
    next.network_login = value.as<bool>();
  }
  else if (std::strcmp(name, "token") == 0)
    return bad_value(name, "the token is read only");
  else
    handled = false;
  return {};
}

Failure apply_settings_request(JsonObjectConst request, LightSettings &settings, net::BoardSettings &board)
{
  LightSettings next = settings;
  net::BoardSettings next_board = board;
  bool any = false;
  for (JsonPairConst field : request)
  {
    const char *name = field.key().c_str();
    JsonVariantConst value = field.value();
    if (std::strcmp(name, "seq") == 0 || std::strcmp(name, "cmd") == 0)
      continue;
    any = true;
    bool handled = false;
    if (Failure failure = apply_board_field(name, value, next_board, handled))
      return failure;
    if (handled)
      continue;
    const LightField *light = find_light_field(name);
    if (!light)
      return fail_field("bad_request", "unknown field", name);
    if (Failure failure = apply_light_field(*light, value, next))
      return failure;
  }
  if (!any)
    return fail("bad_request", "settings_set needs at least one setting");
  settings = next;
  board = next_board;
  return {};
}

void write_settings(JsonObject target, const LightSettings &s, const net::BoardSettings &b, bool with_token)
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
  target["breath_pattern"] = breath_pattern_name(s.breath_pattern);
  target["floor"] = s.floor;
  target["twinkle_strength"] = s.twinkle_strength;
  target["timer_minutes"] = s.timer_minutes;
  target["wifi_power"] = net::wifi_power_name(b.wifi_power);
  target["update_mode"] = net::update_mode_name(b.update_mode);
  target["update_firmware"] = b.update_firmware;
  target["update_web"] = b.update_web;
  target["check_hours"] = b.check_hours;
  target["install_start"] = b.install_start;
  target["install_end"] = b.install_end;
  target["timezone"] = std::string(b.timezone);
  target["time_sync_hours"] = b.time_sync_hours;
  target["ntp_server"] = std::string(b.ntp_server);
  target["network_login"] = b.network_login;
  if (with_token)
    target["token"] = std::string(b.token);
}

} // namespace proto
} // namespace zenit
