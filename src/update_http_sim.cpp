// SPDX-License-Identifier: GPL-3.0-or-later

// The update source as the simulator plays it: a manifest and a firmware file the tests script, or a failure in place
// of either.

#ifdef ZENIT_SIM

#include "update_http.h"

#include <sha256.h>

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "install_target.h"
#include "www.h"

namespace update_http
{

namespace
{
struct Source
{
  std::string manifest_body;
  Outcome manifest_outcome = Outcome::Unreachable;
  std::vector<uint8_t> file;
  Outcome download_outcome = Outcome::Ok;
  size_t manifest_reads = 0;
};
Source sources[2];

Source &source(Target target) { return sources[target == Target::Web ? 1 : 0]; }

bool ends_with(const char *text, const char *end)
{
  const size_t a = std::strlen(text), b = std::strlen(end);
  return a >= b && std::strcmp(text + a - b, end) == 0;
}
} // namespace

Outcome fetch_manifest(const char *url, char *body, size_t capacity, size_t &size)
{
  Source &from = source(ends_with(url, "web/update.json") ? Target::Web : Target::Firmware);
  from.manifest_reads++;
  if (from.manifest_outcome != Outcome::Ok)
    return from.manifest_outcome;
  if (from.manifest_body.size() > capacity)
    return Outcome::BadDownload;
  std::memcpy(body, from.manifest_body.data(), from.manifest_body.size());
  size = from.manifest_body.size();
  return Outcome::Ok;
}

Outcome download(Target target, const char *, const zenit::update::Manifest &manifest, Progress progress)
{
  const uint32_t size = manifest.size;
  const char *sha256 = manifest.sha256;
  const Source &from = source(target);
  if (from.download_outcome != Outcome::Ok)
    return from.download_outcome;
  if (!install_target::begin(target, manifest))
    return Outcome::FlashError;
  zenit::net::Sha256 hash;
  uint32_t sent = 0;
  const size_t chunk = 4096;
  for (size_t at = 0; at < from.file.size(); at += chunk)
  {
    const size_t take = std::min(chunk, from.file.size() - at);
    if (sent + take > size)
    {
      install_target::abort(target);
      return Outcome::BadDownload;
    }
    if (!install_target::write(target, from.file.data() + at, take))
    {
      const bool refused = target == Target::Web && www::install_refused();
      install_target::abort(target);
      return refused ? Outcome::BadDownload : Outcome::FlashError;
    }
    hash.update(from.file.data() + at, take);
    sent += static_cast<uint32_t>(take);
    if (progress)
      progress(static_cast<uint8_t>(static_cast<uint64_t>(sent) * 100 / size));
  }
  uint8_t digest[zenit::net::SHA256_SIZE];
  char hex[zenit::net::SHA256_HEX + 1];
  const bool hashed = hash.finish(digest);
  if (hashed)
    zenit::net::to_hex(digest, hex);
  if (sent != size || !hashed || std::strcmp(hex, sha256) != 0)
  {
    install_target::abort(target);
    return Outcome::BadDownload;
  }
  if (!install_target::end(target))
    return Outcome::FlashError;
  return Outcome::Ok;
}

void sim_set_manifest(Target target, const char *body)
{
  source(target).manifest_body = body;
  source(target).manifest_outcome = Outcome::Ok;
}
void sim_set_manifest_outcome(Target target, Outcome outcome) { source(target).manifest_outcome = outcome; }
void sim_set_file(Target target, const uint8_t *data, size_t size) { source(target).file.assign(data, data + size); }
void sim_set_download_outcome(Target target, Outcome outcome) { source(target).download_outcome = outcome; }
size_t sim_manifest_reads(Target target) { return source(target).manifest_reads; }
void sim_reset()
{
  sources[0] = Source();
  sources[1] = Source();
  // The web manifest offers the image the simulated partition starts with (www::sim_reset), so a check finds the web
  // app up to date until a test publishes another.
  uint8_t *data;
  size_t size;
  www::sim_make_image("1.0.0", 1, 1, data, size);
  sources[1].file.assign(data, data + size);
  zenit::net::Sha256 hash;
  hash.update(data, size);
  uint8_t digest[zenit::net::SHA256_SIZE];
  // The simulator's portable hash cannot fail.
  (void)hash.finish(digest);
  char hex[zenit::net::SHA256_HEX + 1];
  zenit::net::to_hex(digest, hex);
  char body[256];
  std::snprintf(body, sizeof(body),
                "{\"schema\":1,\"version\":\"1.0.0\",\"file\":\"zenit-web-1.0.0.bin\",\"size\":%u,\"sha256\":\"%s\","
                "\"protocol_min\":1,\"protocol_max\":1}",
                static_cast<unsigned>(size), hex);
  sources[1].manifest_body = body;
  sources[1].manifest_outcome = Outcome::Ok;
}

} // namespace update_http

#endif
