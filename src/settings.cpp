// SPDX-License-Identifier: GPL-3.0-or-later

#include "settings.h"

#include "platform.h"
#include "settings_store.h"

#include <favorites.h>
#include <light_record.h>

#include <cstring>

namespace settings
{

namespace
{
zenit::LightSettings values;
zenit::net::BoardSettings board_values;
zenit::update::UpdateRecord update_values;
bool update_readable = true;
bool memory_open = false;
// Whether the settings and the update record were read without an I/O error: a record that failed to read may exist,
// so it is never written over until a restart reads it.
bool settings_read = true;
bool update_read = true;
// The size of the light record in the blob as stored, and whether a version 1 layout is kept (keep_old_layout).
size_t stored_light_size = zenit::LIGHT_RECORD_SIZE;
bool keep_layout = false;
// The favorites (docs/board/light-v1.md#stored-favorites), their own record under their own key. A missing record is
// the ready-made favorites, written only at the first change.
zenit::Favorites favorite_values;
bool favorites_read = true;
// The stored favorites record is damaged: it is written over at the next commit, even of the same favorites.
bool favorites_damaged = false;
constexpr const char *FAVORITES_KEY = "favorites";
// The light record and the board record (docs/board/light-v1.md#stored-settings,
// docs/board/wifi-and-updates-v1.md#stored-settings) are stored together as one blob under one key, so a save of both
// is one atomic write: it is all or nothing even when the power fails.
constexpr const char *SETTINGS_KEY = "settings";
constexpr const char *UPDATE_KEY = "update";
constexpr size_t SETTINGS_BLOB_SIZE = zenit::LIGHT_RECORD_SIZE + zenit::net::BOARD_RECORD_SIZE;

// Writes both records in one step. `light_size` LIGHT_RECORD_V1_SIZE keeps the layout of firmware 1.1.0 and earlier
// (docs/board/light-v1.md#stored-settings), for a write at start that a rollback to that firmware may still read.
bool write_settings(const zenit::LightSettings &light, const zenit::net::BoardSettings &board,
                    size_t light_size = zenit::LIGHT_RECORD_SIZE)
{
  uint8_t blob[SETTINGS_BLOB_SIZE];
  uint8_t light_record[zenit::LIGHT_RECORD_SIZE];
  uint8_t board_record[zenit::net::BOARD_RECORD_SIZE];
  zenit::encode_light_record(light, light_record);
  if (light_size == zenit::LIGHT_RECORD_V1_SIZE)
    light_record[0] = 1; // version 1 is the first 17 bytes of version 2
  else
    light_size = zenit::LIGHT_RECORD_SIZE;
  zenit::net::encode_board_record(board, board_record);
  std::memcpy(blob, light_record, light_size);
  std::memcpy(blob + light_size, board_record, sizeof(board_record));
  return store::write(SETTINGS_KEY, blob, light_size + sizeof(board_record));
}

void make_token(zenit::net::BoardSettings &target) { zenit::net::make_token(target.token, platform::random_bytes); }
} // namespace

void begin()
{
  memory_open = store::begin();
  values = zenit::LightSettings();
  board_values = zenit::net::BoardSettings();
  uint8_t blob[SETTINGS_BLOB_SIZE];
  size_t blob_size = 0;
  const store::Read blob_read = store::read(SETTINGS_KEY, blob, sizeof(blob), blob_size);
  // A missing blob, or a damaged one (a size that is not the one of its light record's version): both records take
  // their defaults. A blob of light record version 1 (firmware 1.1.0 and earlier) keeps every value and is written as
  // version 2 at the next save. After a failed read every value keeps its default too, and nothing is written: the
  // stored settings may be fine.
  settings_read = blob_read != store::Read::Failed;
  const size_t light_size = blob_read == store::Read::Found
                                ? zenit::light_record_size_in_blob(blob, blob_size, zenit::net::BOARD_RECORD_SIZE)
                                : 0;
  stored_light_size = light_size ? light_size : zenit::LIGHT_RECORD_SIZE;
  if (light_size)
  {
    values = zenit::decode_light_record(blob, light_size);
    zenit::net::decode_board_record(blob + light_size, zenit::net::BOARD_RECORD_SIZE, board_values);
  }
  if (!zenit::net::valid_token(board_values.token))
  {
    // First start, or a damaged token: a new one, written at once so every later boot has the same. A version 1 blob
    // stays version 1 here: this firmware may still be on trial, and the previous one reads only that layout.
    make_token(board_values);
    if (!settings_read)
      platform::log("the settings could not be read: running on the defaults, nothing is saved until a restart");
    else if (!write_settings(values, board_values, stored_light_size))
      platform::log("the new token could not be saved");
  }

  favorite_values = zenit::ready_made_favorites();
  static uint8_t favorite_bytes[zenit::FAVORITES_RECORD_SIZE];
  size_t favorite_size = 0;
  const store::Read favorite_state = store::read(FAVORITES_KEY, favorite_bytes, sizeof(favorite_bytes), favorite_size);
  favorites_read = favorite_state != store::Read::Failed;
  favorites_damaged = false;
  if (!favorites_read)
    platform::log("the favorites could not be read: the ready-made ones show, nothing is saved until a restart");
  else if (favorite_state == store::Read::Found &&
           !zenit::decode_favorites_record(favorite_bytes, favorite_size, favorite_values))
  {
    favorites_damaged = true;
    platform::log("the favorites record is damaged: the ready-made favorites show");
  }

  update_values = zenit::update::UpdateRecord();
  uint8_t update_record_bytes[zenit::update::UPDATE_RECORD_SIZE];
  size_t update_size = 0;
  const store::Read update_state =
      store::read(UPDATE_KEY, update_record_bytes, sizeof(update_record_bytes), update_size);
  update_read = update_state != store::Read::Failed;
  if (!update_read)
    platform::log("the update record could not be read");
  update_readable = update_state == store::Read::Missing ||
                    (update_state == store::Read::Found &&
                     zenit::update::decode_update_record(update_record_bytes, update_size, update_values));
}

const zenit::LightSettings &current() { return values; }
const zenit::net::BoardSettings &board() { return board_values; }
const zenit::update::UpdateRecord &update_record() { return update_values; }
bool memory_ok() { return memory_open; }
bool update_record_readable() { return update_readable; }
bool read_ok() { return settings_read && update_read && favorites_read; }
const zenit::Favorites &favorites() { return favorite_values; }

zenit::net::BoardSettings fresh_board_settings()
{
  zenit::net::BoardSettings fresh;
  make_token(fresh);
  return fresh;
}

void keep_old_layout(bool keep) { keep_layout = keep; }

Commit commit(const zenit::LightSettings &next) { return commit_both(next, board_values); }

Commit commit_board(const zenit::net::BoardSettings &next) { return commit_both(values, next); }

Commit commit_both(const zenit::LightSettings &light, const zenit::net::BoardSettings &requested)
{
  zenit::net::BoardSettings board = requested;
  if (!zenit::net::valid_token(board.token))
    make_token(board);
  if (!settings_read)
    return Commit::Failed;
  if (light == values && board == board_values)
    return Commit::Ok;
  // One write for both records: all or nothing, with no state in between to repair
  const size_t light_size = keep_layout && stored_light_size == zenit::LIGHT_RECORD_V1_SIZE &&
                                    light.breath_pattern == zenit::LightSettings().breath_pattern
                                ? zenit::LIGHT_RECORD_V1_SIZE
                                : zenit::LIGHT_RECORD_SIZE;
  if (!write_settings(light, board, light_size))
    return Commit::Failed;
  stored_light_size = light_size;
  values = light;
  board_values = board;
  return Commit::Ok;
}

void use_unsaved(const zenit::LightSettings &light) { values = light; }

Commit commit_favorites(const zenit::Favorites &next)
{
  if (!favorites_read)
    return Commit::Failed;
  if (next == favorite_values && !favorites_damaged)
    return Commit::Ok;
  static uint8_t record[zenit::FAVORITES_RECORD_SIZE];
  zenit::encode_favorites_record(next, record);
  if (!store::write(FAVORITES_KEY, record, sizeof(record)))
    return Commit::Failed;
  favorite_values = next;
  favorites_damaged = false;
  return Commit::Ok;
}

Commit commit_update(const zenit::update::UpdateRecord &next)
{
  if (next == update_values && update_readable)
    return Commit::Ok;
  uint8_t record[zenit::update::UPDATE_RECORD_SIZE];
  zenit::update::encode_update_record(next, record);
  if (!update_read || !store::write(UPDATE_KEY, record, sizeof(record)))
    return Commit::Failed;
  update_values = next;
  update_readable = true;
  return Commit::Ok;
}

#ifdef ZENIT_SIM
void sim_reset_current()
{
  values = zenit::LightSettings();
  board_values = zenit::net::BoardSettings();
  update_values = zenit::update::UpdateRecord();
  update_readable = true;
  favorite_values = zenit::ready_made_favorites();
  favorites_read = true;
  favorites_damaged = false;
  settings_read = true;
  update_read = true;
}
#endif

} // namespace settings
