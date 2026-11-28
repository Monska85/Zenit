// SPDX-License-Identifier: GPL-3.0-or-later

#include "favorites_json.h"

#include <effects.h>

#include <cstdio>
#include <cstring>
#include <string>

namespace zenit
{
namespace proto
{

namespace
{

// One setting of a look, by its parameter bit.
void write_look_setting(JsonObject target, EffectParam param, const char *name, const LightSettings &look)
{
  switch (param)
  {
  case PARAM_COLOR:
    target[name] = color_name(look.color);
    break;
  case PARAM_COLORS:
  {
    JsonArray colors = target[name].to<JsonArray>();
    for (size_t i = 0; i < look.colors.count && i < MAX_COLORS; i++)
      colors.add(color_name(look.colors.color[i]));
    break;
  }
  case PARAM_COLOR_SET:
    target[name] = color_set_name(look.color_set);
    break;
  case PARAM_HOLD:
    target[name] = look.hold_seconds;
    break;
  case PARAM_PERIOD:
    target[name] = look.period_seconds;
    break;
  case PARAM_PATTERN:
    target[name] = breath_pattern_name(look.breath_pattern);
    break;
  case PARAM_FLOOR:
    target[name] = look.floor;
    break;
  case PARAM_STRENGTH:
    target[name] = look.twinkle_strength;
    break;
  case PARAM_TIMER:
    break;
  }
}

Failure bad_name()
{
  char message[96];
  std::snprintf(message, sizeof(message),
                "a name is 1 to %u characters, with no control character and no space at either end",
                static_cast<unsigned>(MAX_FAVORITE_NAME));
  return fail("bad_name", message);
}

} // namespace

Failure read_favorite_id(JsonVariantConst value, uint8_t &id, bool allow_null)
{
  if (allow_null && value.isNull() && !value.isUnbound())
  {
    id = NO_FAVORITE;
    return {};
  }
  if (!value.is<int64_t>() || value.as<int64_t>() < 1 || value.as<int64_t>() > 255)
    return fail("bad_request", allow_null ? "\"id\" must be a whole number from 1 to 255, or null"
                                          : "\"id\" must be a whole number from 1 to 255");
  id = static_cast<uint8_t>(value.as<int64_t>());
  return {};
}

Failure read_favorite_name(JsonVariantConst value, const char *&name)
{
  if (!value.is<const char *>())
    return fail("bad_request", "\"name\" must be text");
  name = value.as<const char *>();
  if (!valid_favorite_name(name, std::strlen(name)))
    return bad_name();
  return {};
}

Failure favorite_failure(FavoriteResult result)
{
  switch (result)
  {
  case FavoriteResult::Ok:
    return {};
  case FavoriteResult::Full:
  {
    char message[48];
    std::snprintf(message, sizeof(message), "the board keeps at most %u favorites",
                  static_cast<unsigned>(MAX_FAVORITES));
    return fail("favorites_full", message);
  }
  case FavoriteResult::Unknown:
    return fail("unknown_favorite", "no favorite has that id");
  case FavoriteResult::BadName:
    return bad_name();
  case FavoriteResult::NameTaken:
    return fail("name_taken", "another favorite has that name");
  }
  return {};
}

void write_favorites(JsonObject reply, const Favorites &favorites)
{
  JsonArray list = reply["favorites"].to<JsonArray>();
  for (size_t i = 0; i < favorites.count && i < MAX_FAVORITES; i++)
  {
    const Favorite &favorite = favorites.items[i];
    JsonObject item = list.add<JsonObject>();
    item["id"] = favorite.id;
    item["name"] = std::string(favorite.name);
    item["effect"] = effect_name(favorite.look.effect);
    item["brightness"] = favorite.look.brightness;
    const uint16_t params = effect_info(favorite.look.effect).params;
    for (const EffectSetting &setting : EFFECT_SETTINGS)
      if (params & setting.param)
        write_look_setting(item, setting.param, setting.name, favorite.look);
  }
  if (favorites.start == NO_FAVORITE)
    reply["start"] = nullptr;
  else
    reply["start"] = favorites.start;
}

} // namespace proto
} // namespace zenit
