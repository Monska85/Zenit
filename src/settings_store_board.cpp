// SPDX-License-Identifier: GPL-3.0-or-later

#ifndef ZENIT_SIM

#include "settings_store.h"

#include <Preferences.h>

#include "platform.h"

namespace settings
{
namespace store
{

namespace
{
Preferences preferences;
bool opened = false;
} // namespace

bool begin()
{
  opened = preferences.begin("zenit", false);
  if (!opened)
    platform::log("cannot open the settings memory");
  return opened;
}

size_t read(const char *key, uint8_t *out, size_t capacity)
{
  if (!opened || !preferences.isKey(key))
    return 0;
  const size_t size = preferences.getBytesLength(key);
  if (size == 0 || size > capacity)
    return size;
  return preferences.getBytes(key, out, capacity);
}

bool write(const char *key, const uint8_t *data, size_t size)
{
  return opened && preferences.putBytes(key, data, size) == size;
}

} // namespace store
} // namespace settings

#endif
