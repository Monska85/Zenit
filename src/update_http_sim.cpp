// SPDX-License-Identifier: GPL-3.0-or-later

// The update source as the simulator plays it: a manifest and a firmware file the tests script, or a failure in place
// of either.

#ifdef ZENIT_SIM

#include "update_http.h"

#include <sha256.h>

#include <algorithm>
#include <cstring>
#include <string>
#include <vector>

#include "firmware.h"

namespace update_http
{

namespace
{
std::string manifest_body;
Outcome manifest_outcome = Outcome::Unreachable;
std::vector<uint8_t> firmware_file;
Outcome download_outcome = Outcome::Ok;
} // namespace

Outcome fetch_manifest(const char *, char *body, size_t capacity, size_t &size)
{
  if (manifest_outcome != Outcome::Ok)
    return manifest_outcome;
  if (manifest_body.size() > capacity)
    return Outcome::BadDownload;
  std::memcpy(body, manifest_body.data(), manifest_body.size());
  size = manifest_body.size();
  return Outcome::Ok;
}

Outcome download_firmware(const char *, uint32_t size, const char *sha256, Progress progress)
{
  if (download_outcome != Outcome::Ok)
    return download_outcome;
  if (!firmware::begin_install(size))
    return Outcome::FlashError;
  zenit::net::Sha256 hash;
  uint32_t sent = 0;
  const size_t chunk = 4096;
  for (size_t at = 0; at < firmware_file.size(); at += chunk)
  {
    const size_t take = std::min(chunk, firmware_file.size() - at);
    if (sent + take > size)
    {
      firmware::abort_install();
      return Outcome::BadDownload;
    }
    if (!firmware::write(firmware_file.data() + at, take))
    {
      firmware::abort_install();
      return Outcome::FlashError;
    }
    hash.update(firmware_file.data() + at, take);
    sent += static_cast<uint32_t>(take);
    if (progress)
      progress(static_cast<uint8_t>(static_cast<uint64_t>(sent) * 100 / size));
  }
  uint8_t digest[zenit::net::SHA256_SIZE];
  hash.finish(digest);
  char hex[zenit::net::SHA256_HEX + 1];
  zenit::net::to_hex(digest, hex);
  if (sent != size || std::strcmp(hex, sha256) != 0)
  {
    firmware::abort_install();
    return Outcome::BadDownload;
  }
  if (!firmware::end_install())
    return Outcome::FlashError;
  return Outcome::Ok;
}

void sim_set_manifest(const char *body)
{
  manifest_body = body;
  manifest_outcome = Outcome::Ok;
}
void sim_set_manifest_outcome(Outcome outcome) { manifest_outcome = outcome; }
void sim_set_firmware(const uint8_t *data, size_t size) { firmware_file.assign(data, data + size); }
void sim_set_download_outcome(Outcome outcome) { download_outcome = outcome; }
void sim_reset()
{
  manifest_body.clear();
  manifest_outcome = Outcome::Unreachable;
  firmware_file.clear();
  download_outcome = Outcome::Ok;
}

} // namespace update_http

#endif
