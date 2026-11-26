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
bool failing_reads = false;
std::string failing_read_key;
size_t writes = 0;
} // namespace

namespace store
{

bool begin() { return true; }

Read read(const char *key, uint8_t *out, size_t capacity, size_t &size)
{
  size = 0;
  // A failing read fails whether the record exists or not, as an I/O error of the board's memory does
  if (failing_reads || (!failing_read_key.empty() && failing_read_key == key))
    return Read::Failed;
  auto found = memory.find(key);
  if (found == memory.end())
    return Read::Missing;
  const std::vector<uint8_t> &record = found->second;
  if (record.size() <= capacity)
    std::memcpy(out, record.data(), record.size());
  size = record.size();
  return Read::Found;
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

void sim_fail_reads(bool fail) { failing_reads = fail; }

void sim_fail_read_key(const char *key) { failing_read_key = key; }

std::vector<uint8_t> sim_read_raw(const char *key)
{
  auto found = memory.find(key);
  return found == memory.end() ? std::vector<uint8_t>() : found->second;
}

void sim_write_raw(const char *key, const std::vector<uint8_t> &bytes) { memory[key] = bytes; }

} // namespace settings

#endif
