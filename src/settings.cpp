// SPDX-License-Identifier: GPL-3.0-or-later

#include "settings.h"

#include "settings_store.h"

#include <light_record.h>

namespace settings
{

namespace
{
zenit::LightSettings values;
// The record of the light settings (docs/board/light-v1.md#stored-settings).
constexpr const char *LIGHT_KEY = "light";
} // namespace

void begin()
{
  store::begin();
  values = zenit::LightSettings();
  uint8_t record[zenit::LIGHT_RECORD_SIZE];
  const size_t size = store::read(LIGHT_KEY, record, sizeof(record));
  if (size == sizeof(record))
    values = zenit::decode_light_record(record, size);
}

const zenit::LightSettings &current() { return values; }

Commit commit(const zenit::LightSettings &next)
{
  if (next == values)
    return Commit::Ok;
  uint8_t record[zenit::LIGHT_RECORD_SIZE];
  zenit::encode_light_record(next, record);
  if (!store::write(LIGHT_KEY, record, sizeof(record)))
    return Commit::Failed;
  values = next;
  return Commit::Ok;
}

#ifdef ZENIT_SIM
void sim_reset_current() { values = zenit::LightSettings(); }
#endif

} // namespace settings
