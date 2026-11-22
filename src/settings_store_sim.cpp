// SPDX-License-Identifier: GPL-3.0-or-later

#ifdef ZENIT_SIM

#include "settings.h"
#include "settings_store.h"

#include <cstring>
#include <map>
#include <string>
#include <vector>

namespace settings
{

namespace
{
std::map<std::string, std::vector<uint8_t>> memory;
bool failing = false;
std::string failing_key;
size_t writes = 0;
} // namespace

namespace store
{

bool begin() { return true; }

size_t read(const char *key, uint8_t *out, size_t capacity)
{
  auto found = memory.find(key);
  if (found == memory.end())
    return 0;
  const std::vector<uint8_t> &record = found->second;
  if (record.size() <= capacity)
    std::memcpy(out, record.data(), record.size());
  return record.size();
}

bool write(const char *key, const uint8_t *data, size_t size)
{
  if (failing || (!failing_key.empty() && failing_key == key))
    return false;
  memory[key] = std::vector<uint8_t>(data, data + size);
  writes++;
  return true;
}

} // namespace store

void sim_store(const zenit::LightSettings &stored)
{
  memory.clear();
  const bool was_failing = failing;
  failing = false;
  sim_reset_current();
  commit(stored);
  failing = was_failing;
}

size_t sim_write_count() { return writes; }

void sim_clear() { memory.clear(); }

void sim_fail_writes(bool fail) { failing = fail; }

void sim_fail_key(const char *key) { failing_key = key; }

void sim_write_raw(const char *key, const std::vector<uint8_t> &bytes) { memory[key] = bytes; }

} // namespace settings

#endif
