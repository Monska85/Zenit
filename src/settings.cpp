// SPDX-License-Identifier: GPL-3.0-or-later

#include "settings.h"

#include "platform.h"
#include "settings_store.h"

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
// The light record and the board record (docs/board/light-v1.md#stored-settings,
// docs/board/wifi-and-updates-v1.md#stored-settings) are stored together as one blob under one key, so a save of both
// is one atomic write: it is all or nothing even when the power fails. Boards from before the blob have the two records
// under their own keys (`light`, `board`), which are read while the blob is missing.
constexpr const char *SETTINGS_KEY = "settings";
constexpr const char *LEGACY_LIGHT_KEY = "light";
constexpr const char *LEGACY_BOARD_KEY = "board";
constexpr const char *UPDATE_KEY = "update";
constexpr size_t SETTINGS_BLOB_SIZE = zenit::LIGHT_RECORD_SIZE + zenit::net::BOARD_RECORD_SIZE;

// Writes both records in one step.
bool write_settings(const zenit::LightSettings &light, const zenit::net::BoardSettings &board)
{
  uint8_t blob[SETTINGS_BLOB_SIZE];
  uint8_t light_record[zenit::LIGHT_RECORD_SIZE];
  uint8_t board_record[zenit::net::BOARD_RECORD_SIZE];
  zenit::encode_light_record(light, light_record);
  zenit::net::encode_board_record(board, board_record);
  std::memcpy(blob, light_record, sizeof(light_record));
  std::memcpy(blob + sizeof(light_record), board_record, sizeof(board_record));
  return store::write(SETTINGS_KEY, blob, sizeof(blob));
}

void make_token(zenit::net::BoardSettings &target) { zenit::net::make_token(target.token, platform::random_bytes); }
} // namespace

void begin()
{
  memory_open = store::begin();
  values = zenit::LightSettings();
  board_values = zenit::net::BoardSettings();
  uint8_t light_record[zenit::LIGHT_RECORD_SIZE];
  uint8_t board_record[zenit::net::BOARD_RECORD_SIZE];
  size_t light_size = 0, board_size = 0;
  uint8_t blob[SETTINGS_BLOB_SIZE];
  const size_t blob_size = store::read(SETTINGS_KEY, blob, sizeof(blob));
  if (blob_size == sizeof(blob))
  {
    std::memcpy(light_record, blob, sizeof(light_record));
    std::memcpy(board_record, blob + sizeof(light_record), sizeof(board_record));
    light_size = sizeof(light_record);
    board_size = sizeof(board_record);
  }
  else if (blob_size == 0)
  {
    light_size = store::read(LEGACY_LIGHT_KEY, light_record, sizeof(light_record));
    board_size = store::read(LEGACY_BOARD_KEY, board_record, sizeof(board_record));
  }
  // A blob of another size is damaged: both records take their defaults
  if (light_size == sizeof(light_record))
    values = zenit::decode_light_record(light_record, light_size);
  zenit::net::decode_board_record(board_record, board_size == sizeof(board_record) ? board_size : 0, board_values);
  if (!zenit::net::valid_token(board_values.token))
  {
    // First start, or a damaged token: a new one, written at once so every later boot has the same.
    make_token(board_values);
    if (!write_settings(values, board_values))
      platform::log("the new token could not be saved");
  }

  update_values = zenit::update::UpdateRecord();
  uint8_t update_record_bytes[zenit::update::UPDATE_RECORD_SIZE];
  const size_t update_size = store::read(UPDATE_KEY, update_record_bytes, sizeof(update_record_bytes));
  update_readable =
      update_size == 0 || zenit::update::decode_update_record(update_record_bytes, update_size, update_values);
}

const zenit::LightSettings &current() { return values; }
const zenit::net::BoardSettings &board() { return board_values; }
const zenit::update::UpdateRecord &update_record() { return update_values; }
bool memory_ok() { return memory_open; }
bool update_record_readable() { return update_readable; }

zenit::net::BoardSettings fresh_board_settings()
{
  zenit::net::BoardSettings fresh;
  make_token(fresh);
  return fresh;
}

Commit commit(const zenit::LightSettings &next)
{
  if (next == values)
    return Commit::Ok;
  if (!write_settings(next, board_values))
    return Commit::Failed;
  values = next;
  return Commit::Ok;
}

Commit commit_board(const zenit::net::BoardSettings &requested)
{
  zenit::net::BoardSettings next = requested;
  if (!zenit::net::valid_token(next.token))
    make_token(next);
  if (next == board_values)
    return Commit::Ok;
  if (!write_settings(values, next))
    return Commit::Failed;
  board_values = next;
  return Commit::Ok;
}

Commit commit_both(const zenit::LightSettings &light, const zenit::net::BoardSettings &requested)
{
  zenit::net::BoardSettings board = requested;
  if (!zenit::net::valid_token(board.token))
    make_token(board);
  if (light == values && board == board_values)
    return Commit::Ok;
  // One write for both records: all or nothing, with no state in between to repair
  if (!write_settings(light, board))
    return Commit::Failed;
  values = light;
  board_values = board;
  return Commit::Ok;
}

Commit commit_update(const zenit::update::UpdateRecord &next)
{
  if (next == update_values && update_readable)
    return Commit::Ok;
  uint8_t record[zenit::update::UPDATE_RECORD_SIZE];
  zenit::update::encode_update_record(next, record);
  if (!store::write(UPDATE_KEY, record, sizeof(record)))
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
}
#endif

} // namespace settings
