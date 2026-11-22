// SPDX-License-Identifier: GPL-3.0-or-later

// The `www` partition as the simulator plays it: the bytes in memory, with the board's writer and reader, and failure
// injection.

#ifdef ZENIT_SIM

#include "www.h"

#include <proto_limits.h>
#include <sha256.h>
#include <web_image.h>

#include <cstring>
#include <string>
#include <vector>

#include "platform.h"

namespace www
{

namespace
{
using zenit::update::WebState;

std::vector<uint8_t> partition(zenit::net::WEB_PARTITION_SIZE, 0xFF);
zenit::net::Asset assets_[zenit::net::MAX_WEB_FILES];
size_t count_ = 0;
char version_[zenit::net::WEB_VERSION_FIELD + 1] = {0};
WebState state_ = WebState::Missing;
std::string failing;
std::vector<uint8_t> made;

class MemoryFlash : public zenit::net::WebFlash
{
public:
  bool erase(uint32_t offset, uint32_t size) override
  {
    if (offset % zenit::net::WEB_SECTOR_SIZE || size % zenit::net::WEB_SECTOR_SIZE || offset + size > partition.size())
      return false;
    std::memset(partition.data() + offset, 0xFF, size);
    return true;
  }
  bool write(uint32_t offset, const uint8_t *data, size_t size) override
  {
    if (failing == "write" || offset + size > partition.size())
      return false;
    // NOR flash only clears bits: writing over bytes that were not erased is a bug of the writer.
    for (size_t i = 0; i < size; i++)
      if (partition[offset + i] != 0xFF)
        return false;
    std::memcpy(partition.data() + offset, data, size);
    return true;
  }
};

MemoryFlash flash;
zenit::net::WebWriter writer;

void load()
{
  zenit::net::WebImageInfo info;
  const char *why = "";
  const bool valid = zenit::net::read_web_image(partition.data(), partition.size(), info, assets_, count_, why);
  version_[0] = '\0';
  if (valid)
    std::strcpy(version_, info.version);
  else
    count_ = 0;
  state_ = zenit::update::judge_web_image(valid, info.protocol_min, info.protocol_max, zenit::proto::PROTOCOL_VERSION);
}

void put16(std::vector<uint8_t> &out, size_t at, uint32_t value)
{
  out[at] = value & 0xFF;
  out[at + 1] = (value >> 8) & 0xFF;
}
void put32(std::vector<uint8_t> &out, size_t at, uint32_t value)
{
  for (int i = 0; i < 4; i++)
    out[at + i] = (value >> (8 * i)) & 0xFF;
}
} // namespace

void begin() { load(); }
WebState state() { return state_; }

Info info()
{
  Info out;
  out.state = state_;
  // A version belongs to an image that reads: none while installing or missing.
  const bool has_image = out.state == WebState::Ok || out.state == WebState::Incompatible;
  std::strcpy(out.version, has_image ? version_ : "");
  return out;
}

bool serve_begin(const zenit::net::Asset *&assets, size_t &count)
{
  if (state_ != WebState::Ok)
    return false;
  assets = assets_;
  count = count_;
  return true;
}
void serve_end() {}

bool begin_install(uint32_t size, const char *version)
{
  if (failing == "begin")
    return false;
  state_ = WebState::Installing;
  count_ = 0;
  if (!writer.begin(flash, size, version, zenit::proto::PROTOCOL_VERSION))
  {
    load();
    return false;
  }
  return true;
}

bool write(const uint8_t *data, size_t size) { return writer.write(data, size); }
bool install_refused() { return writer.refused(); }

bool end_install()
{
  const bool written = failing != "end" && writer.finish();
  load();
  return written && state_ != WebState::Missing;
}

void abort_install() { load(); }

void sim_make_image(const char *version, uint8_t protocol_min, uint8_t protocol_max, uint8_t *&data, size_t &size)
{
  static const char PAGE[] = "<!doctype html><title>Zenit</title>";
  static const char PATH[] = "index.html";
  static const char TYPE[] = "text/html; charset=utf-8";
  std::vector<uint8_t> body;
  body.push_back(sizeof(PATH) - 1);
  body.insert(body.end(), PATH, PATH + sizeof(PATH));
  body.push_back(sizeof(TYPE) - 1);
  body.insert(body.end(), TYPE, TYPE + sizeof(TYPE));
  const size_t entry = body.size();
  body.resize(entry + 8);
  put32(body, entry, static_cast<uint32_t>(body.size()));
  put32(body, entry + 4, sizeof(PAGE) - 1);
  body.insert(body.end(), PAGE, PAGE + sizeof(PAGE) - 1);

  made.assign(zenit::net::WEB_HEADER_SIZE, 0);
  std::memcpy(made.data(), "ZWEB", 4);
  made[4] = zenit::net::WEB_IMAGE_FORMAT;
  made[5] = protocol_min;
  made[6] = protocol_max;
  std::strncpy(reinterpret_cast<char *>(made.data() + 8), version, zenit::net::WEB_VERSION_FIELD);
  put16(made, 24, 1);
  put32(made, 28, static_cast<uint32_t>(body.size()));
  zenit::net::Sha256 hash;
  hash.update(body.data(), body.size());
  uint8_t digest[zenit::net::SHA256_SIZE];
  hash.finish(digest);
  std::memcpy(made.data() + 32, digest, sizeof(digest));
  made.insert(made.end(), body.begin(), body.end());
  data = made.data();
  size = made.size();
}

void sim_load(const uint8_t *data, size_t size)
{
  std::fill(partition.begin(), partition.end(), 0xFF);
  std::memcpy(partition.data(), data, size < partition.size() ? size : partition.size());
  load();
}

void sim_erase()
{
  std::fill(partition.begin(), partition.end(), 0xFF);
  load();
}

void sim_fail(const char *step) { failing = step ? step : ""; }

void sim_reset()
{
  failing.clear();
  uint8_t *data;
  size_t size;
  sim_make_image("1.0.0", 1, 1, data, size);
  sim_load(data, size);
}

} // namespace www

#endif
