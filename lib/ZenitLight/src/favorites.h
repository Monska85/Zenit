// SPDX-License-Identifier: GPL-3.0-or-later

// Favorites (docs/board/light-v1.md#favorites): named light looks the board keeps, the one it turns on with, and their
// stored record. Pure logic: the board, the simulator and the tests run it unchanged.

#pragma once

#include <cstddef>
#include <cstdint>

#include "light_record.h"
#include "light_settings.h"

namespace zenit
{

constexpr size_t MAX_FAVORITES = 6;
// A name is 1 to MAX_FAVORITE_NAME characters (Unicode code points), at most 4 UTF-8 bytes each.
constexpr size_t MAX_FAVORITE_NAME = 20;
constexpr size_t MAX_FAVORITE_NAME_BYTES = 4 * MAX_FAVORITE_NAME;
constexpr uint8_t NO_FAVORITE = 0; // the id of none: ids are 1 to 255

struct Favorite
{
  uint8_t id = NO_FAVORITE;
  char name[MAX_FAVORITE_NAME_BYTES + 1] = {0};
  // The whole light record as it was saved, with no timer: applying uses the effect, the brightness and the settings
  // that effect reads (apply_favorite_look).
  LightSettings look;
  bool operator==(const Favorite &other) const;
};

struct Favorites
{
  Favorite items[MAX_FAVORITES];
  uint8_t count = 0;
  uint8_t start = NO_FAVORITE; // "Turn on with this": the id of a favorite, or NO_FAVORITE
  uint8_t next_id = 1;         // where the search for a free id starts at the next save
  bool operator==(const Favorites &other) const;
  bool operator!=(const Favorites &other) const { return !(*this == other); }
};

// The favorites of a board that has no record: "Starry night" and "Christmas".
Favorites ready_made_favorites();

// Whether `name` (`size` bytes, no terminator needed) is a valid favorite name: valid UTF-8, 1 to MAX_FAVORITE_NAME
// code points, no control or invisible formatting character, no space at either end.
bool valid_favorite_name(const char *name, size_t size);
// Whether two names are the same: equal bytes, with ASCII letters compared without case.
bool same_favorite_name(const char *a, const char *b);

// The favorite with that id, or nullptr.
const Favorite *find_favorite(const Favorites &favorites, uint8_t id);

enum class FavoriteResult : uint8_t
{
  Ok,
  Full,      // a new favorite and MAX_FAVORITES already
  Unknown,   // no favorite has that id
  BadName,   // the name breaks the rules
  NameTaken, // another favorite has the same name
};

// The operations of the protocol. Each changes `favorites` only on Ok. Names are null-terminated.
// A new favorite, last, with the next free id, holding `look` (its timer dropped).
FavoriteResult add_favorite(Favorites &favorites, const char *name, const LightSettings &look);
// Replaces the look of a favorite, keeping its name, its place and its mark.
FavoriteResult replace_favorite(Favorites &favorites, uint8_t id, const LightSettings &look);
FavoriteResult rename_favorite(Favorites &favorites, uint8_t id, const char *name);
// Deleting the favorite that carries the mark clears the mark.
FavoriteResult delete_favorite(Favorites &favorites, uint8_t id);
// `id` NO_FAVORITE clears the mark.
FavoriteResult set_start_favorite(Favorites &favorites, uint8_t id);

// `current` with the look of `favorite` applied: its effect, its brightness and the settings its effect reads; the
// other settings and the timer keep their values.
LightSettings apply_favorite_look(const LightSettings &current, const Favorite &favorite);

// The stored record (docs/board/light-v1.md#stored-favorites).
constexpr uint8_t FAVORITES_RECORD_VERSION = 1;
// An entry: the id, the name padded with 0, the look as a light record.
constexpr size_t FAVORITE_NAME_OFFSET = 1;
constexpr size_t FAVORITE_LOOK_OFFSET = FAVORITE_NAME_OFFSET + MAX_FAVORITE_NAME_BYTES;
constexpr size_t FAVORITE_ENTRY_SIZE = FAVORITE_LOOK_OFFSET + LIGHT_RECORD_SIZE;
constexpr size_t FAVORITES_HEADER_SIZE = 4;
constexpr size_t FAVORITES_RECORD_SIZE = FAVORITES_HEADER_SIZE + MAX_FAVORITES * FAVORITE_ENTRY_SIZE;

void encode_favorites_record(const Favorites &favorites, uint8_t (&out)[FAVORITES_RECORD_SIZE]);
// False when the record is damaged (another size or version, a count above MAX_FAVORITES): `out` is then the ready-made
// favorites. An entry that cannot be read (id 0 or repeated, a bad name, a light record of another version or an
// unknown effect) is left out, and a start id that names no entry counts as none.
bool decode_favorites_record(const uint8_t *record, size_t size, Favorites &out);

} // namespace zenit
