// SPDX-License-Identifier: GPL-3.0-or-later

#include "favorites.h"

#include "effects.h"

#include <cstring>

namespace zenit
{

namespace
{

// The next code point of a UTF-8 text, or false when the bytes at `i` are not a well-formed sequence (overlong forms,
// surrogates and values above U+10FFFF included).
bool next_code_point(const uint8_t *text, size_t size, size_t &i, uint32_t &cp)
{
  const uint8_t lead = text[i];
  size_t length = 0;
  uint32_t minimum = 0;
  if (lead < 0x80)
  {
    cp = lead;
    i++;
    return true;
  }
  if (lead >= 0xC2 && lead <= 0xDF)
  {
    length = 2;
    cp = lead & 0x1F;
    minimum = 0x80;
  }
  else if (lead >= 0xE0 && lead <= 0xEF)
  {
    length = 3;
    cp = lead & 0x0F;
    minimum = 0x800;
  }
  else if (lead >= 0xF0 && lead <= 0xF4)
  {
    length = 4;
    cp = lead & 0x07;
    minimum = 0x10000;
  }
  else
    return false;
  if (size - i < length)
    return false;
  for (size_t k = 1; k < length; k++)
  {
    const uint8_t byte = text[i + k];
    if ((byte & 0xC0) != 0x80)
      return false;
    cp = (cp << 6) | (byte & 0x3F);
  }
  if (cp < minimum || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF))
    return false;
  i += length;
  return true;
}

// Control characters and invisible formatting characters, which a name may not hold.
bool refused_in_name(uint32_t cp)
{
  return cp < 0x20 || (cp >= 0x7F && cp <= 0x9F) || (cp >= 0x200B && cp <= 0x200F) || (cp >= 0x2028 && cp <= 0x202E) ||
         (cp >= 0x2060 && cp <= 0x206F) || cp == 0xFEFF;
}

char ascii_lower(char c) { return c >= 'A' && c <= 'Z' ? static_cast<char>(c - 'A' + 'a') : c; }

bool name_taken(const Favorites &favorites, const char *name, uint8_t except_id)
{
  for (size_t i = 0; i < favorites.count; i++)
    if (favorites.items[i].id != except_id && same_favorite_name(favorites.items[i].name, name))
      return true;
  return false;
}

Favorite *find_mutable(Favorites &favorites, uint8_t id)
{
  return const_cast<Favorite *>(find_favorite(favorites, id));
}

LightSettings without_timer(LightSettings look)
{
  look.timer_minutes = 0;
  return look;
}

void set_name(Favorite &favorite, const char *name)
{
  std::memset(favorite.name, 0, sizeof(favorite.name));
  std::memcpy(favorite.name, name, std::strlen(name));
}

Favorite make(uint8_t id, const char *name, const LightSettings &look)
{
  Favorite favorite;
  favorite.id = id;
  set_name(favorite, name);
  favorite.look = without_timer(look);
  return favorite;
}

} // namespace

bool Favorite::operator==(const Favorite &other) const
{
  return id == other.id && std::strcmp(name, other.name) == 0 && look == other.look;
}

bool Favorites::operator==(const Favorites &other) const
{
  if (count != other.count || start != other.start || next_id != other.next_id)
    return false;
  for (size_t i = 0; i < count; i++)
    if (!(items[i] == other.items[i]))
      return false;
  return true;
}

Favorites ready_made_favorites()
{
  Favorites favorites;
  LightSettings starry;
  starry.effect = Effect::ShootingStar;
  starry.color = Color::White;
  LightSettings christmas;
  christmas.effect = Effect::Christmas;
  christmas.color_set = ColorSet::Christmas;
  christmas.hold_seconds = 30;
  favorites.items[0] = make(1, "Starry night", starry);
  favorites.items[1] = make(2, "Christmas", christmas);
  favorites.count = 2;
  favorites.next_id = 3;
  return favorites;
}

bool valid_favorite_name(const char *name, size_t size)
{
  if (!name || size == 0 || size > MAX_FAVORITE_NAME_BYTES || name[0] == ' ' || name[size - 1] == ' ')
    return false;
  const uint8_t *text = reinterpret_cast<const uint8_t *>(name);
  size_t i = 0;
  size_t characters = 0;
  while (i < size)
  {
    uint32_t cp = 0;
    if (!next_code_point(text, size, i, cp) || refused_in_name(cp))
      return false;
    if (++characters > MAX_FAVORITE_NAME)
      return false;
  }
  return true;
}

bool same_favorite_name(const char *a, const char *b)
{
  for (; *a && *b; a++, b++)
    if (ascii_lower(*a) != ascii_lower(*b))
      return false;
  return *a == *b;
}

const Favorite *find_favorite(const Favorites &favorites, uint8_t id)
{
  if (id == NO_FAVORITE)
    return nullptr;
  for (size_t i = 0; i < favorites.count; i++)
    if (favorites.items[i].id == id)
      return &favorites.items[i];
  return nullptr;
}

FavoriteResult add_favorite(Favorites &favorites, const char *name, const LightSettings &look)
{
  if (!valid_favorite_name(name, std::strlen(name)))
    return FavoriteResult::BadName;
  if (name_taken(favorites, name, NO_FAVORITE))
    return FavoriteResult::NameTaken;
  if (favorites.count >= MAX_FAVORITES)
    return FavoriteResult::Full;
  // At most MAX_FAVORITES ids are in use, so a free one is found within MAX_FAVORITES + 1 steps
  uint8_t id = favorites.next_id == NO_FAVORITE ? 1 : favorites.next_id;
  while (find_favorite(favorites, id))
    id = id == 255 ? 1 : static_cast<uint8_t>(id + 1);
  favorites.items[favorites.count++] = make(id, name, look);
  favorites.next_id = id == 255 ? 1 : static_cast<uint8_t>(id + 1);
  return FavoriteResult::Ok;
}

FavoriteResult replace_favorite(Favorites &favorites, uint8_t id, const LightSettings &look)
{
  Favorite *favorite = find_mutable(favorites, id);
  if (!favorite)
    return FavoriteResult::Unknown;
  favorite->look = without_timer(look);
  return FavoriteResult::Ok;
}

FavoriteResult rename_favorite(Favorites &favorites, uint8_t id, const char *name)
{
  Favorite *favorite = find_mutable(favorites, id);
  if (!favorite)
    return FavoriteResult::Unknown;
  if (!valid_favorite_name(name, std::strlen(name)))
    return FavoriteResult::BadName;
  if (name_taken(favorites, name, id))
    return FavoriteResult::NameTaken;
  set_name(*favorite, name);
  return FavoriteResult::Ok;
}

FavoriteResult delete_favorite(Favorites &favorites, uint8_t id)
{
  const Favorite *favorite = find_favorite(favorites, id);
  if (!favorite)
    return FavoriteResult::Unknown;
  const size_t index = static_cast<size_t>(favorite - favorites.items);
  for (size_t i = index; i + 1 < favorites.count; i++)
    favorites.items[i] = favorites.items[i + 1];
  favorites.count--;
  favorites.items[favorites.count] = Favorite();
  if (favorites.start == id)
    favorites.start = NO_FAVORITE;
  return FavoriteResult::Ok;
}

FavoriteResult set_start_favorite(Favorites &favorites, uint8_t id)
{
  if (id != NO_FAVORITE && !find_favorite(favorites, id))
    return FavoriteResult::Unknown;
  favorites.start = id;
  return FavoriteResult::Ok;
}

LightSettings apply_favorite_look(const LightSettings &current, const Favorite &favorite)
{
  const LightSettings &look = favorite.look;
  LightSettings next = current;
  next.effect = look.effect;
  next.brightness = look.brightness;
  const uint16_t params = effect_info(look.effect).params;
  if (params & PARAM_COLOR)
    next.color = look.color;
  if (params & PARAM_COLORS)
    next.colors = look.colors;
  if (params & PARAM_COLOR_SET)
    next.color_set = look.color_set;
  if (params & PARAM_HOLD)
    next.hold_seconds = look.hold_seconds;
  if (params & PARAM_PERIOD)
    next.period_seconds = look.period_seconds;
  if (params & PARAM_PATTERN)
    next.breath_pattern = look.breath_pattern;
  if (params & PARAM_FLOOR)
    next.floor = look.floor;
  if (params & PARAM_STRENGTH)
    next.twinkle_strength = look.twinkle_strength;
  // PARAM_TIMER: the timer is the whole light's, never part of a look
  return next;
}

void encode_favorites_record(const Favorites &favorites, uint8_t (&out)[FAVORITES_RECORD_SIZE])
{
  std::memset(out, 0, sizeof(out));
  out[0] = FAVORITES_RECORD_VERSION;
  out[1] = favorites.count;
  out[2] = favorites.start;
  out[3] = favorites.next_id;
  for (size_t i = 0; i < favorites.count && i < MAX_FAVORITES; i++)
  {
    uint8_t *entry = out + FAVORITES_HEADER_SIZE + i * FAVORITE_ENTRY_SIZE;
    const Favorite &favorite = favorites.items[i];
    entry[0] = favorite.id;
    std::memcpy(entry + FAVORITE_NAME_OFFSET, favorite.name, std::strlen(favorite.name));
    uint8_t look[LIGHT_RECORD_SIZE];
    encode_light_record(without_timer(favorite.look), look);
    std::memcpy(entry + FAVORITE_LOOK_OFFSET, look, sizeof(look));
  }
}

bool decode_favorites_record(const uint8_t *in, size_t size, Favorites &out)
{
  out = ready_made_favorites();
  if (!in || size != FAVORITES_RECORD_SIZE || in[0] != FAVORITES_RECORD_VERSION || in[1] > MAX_FAVORITES)
    return false;
  Favorites read;
  read.next_id = in[3];
  for (size_t i = 0; i < in[1]; i++)
  {
    const uint8_t *entry = in + FAVORITES_HEADER_SIZE + i * FAVORITE_ENTRY_SIZE;
    const uint8_t id = entry[0];
    const char *name = reinterpret_cast<const char *>(entry + FAVORITE_NAME_OFFSET);
    size_t name_size = 0;
    while (name_size < MAX_FAVORITE_NAME_BYTES && name[name_size] != '\0')
      name_size++;
    const uint8_t *look = entry + FAVORITE_LOOK_OFFSET;
    if (id == NO_FAVORITE || find_favorite(read, id) || !valid_favorite_name(name, name_size) ||
        !light_record_is_current(look, LIGHT_RECORD_SIZE))
      continue;
    Favorite candidate;
    std::memcpy(candidate.name, name, name_size);
    if (name_taken(read, candidate.name, NO_FAVORITE))
      continue;
    Favorite &favorite = read.items[read.count++];
    favorite = candidate;
    favorite.id = id;
    favorite.look = without_timer(decode_light_record(look, LIGHT_RECORD_SIZE));
  }
  read.start = find_favorite(read, in[2]) ? in[2] : NO_FAVORITE;
  out = read;
  return true;
}

} // namespace zenit
