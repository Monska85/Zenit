// SPDX-License-Identifier: GPL-3.0-or-later

#ifndef ZENIT_SIM

#include "settings_store.h"

#include <nvs.h>

#include "platform.h"

namespace settings
{
namespace store
{

namespace
{
// NVS itself is set up by the framework before setup(); the firmware opens its namespace.
nvs_handle_t handle = 0;
bool opened = false;
} // namespace

bool begin()
{
  if (!opened)
    opened = nvs_open("zenit", NVS_READWRITE, &handle) == ESP_OK;
  if (!opened)
    platform::log("cannot open the settings memory");
  return opened;
}

Read read(const char *key, uint8_t *out, size_t capacity, size_t &size)
{
  size = 0;
  if (!opened)
    return Read::Failed;
  size_t length = 0;
  esp_err_t err = nvs_get_blob(handle, key, nullptr, &length);
  // Only "not found" means missing: any other error may hide a record that exists
  if (err == ESP_ERR_NVS_NOT_FOUND)
    return Read::Missing;
  if (err != ESP_OK)
    return Read::Failed;
  size = length;
  if (length == 0 || length > capacity)
    return Read::Found; // a record of the wrong size: the caller judges it damaged
  err = nvs_get_blob(handle, key, out, &length);
  if (err != ESP_OK || length != size)
    return Read::Failed;
  return Read::Found;
}

bool write(const char *key, const uint8_t *data, size_t size)
{
  return opened && nvs_set_blob(handle, key, data, size) == ESP_OK && nvs_commit(handle) == ESP_OK;
}

} // namespace store
} // namespace settings

#endif
