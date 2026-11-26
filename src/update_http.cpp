// SPDX-License-Identifier: GPL-3.0-or-later

// The part of a download that does not depend on the transport, shared by the board and the simulator: the install
// into the target, the hash and the checks against the manifest.

#include "update_http.h"

#include <sha256.h>

#include <cstring>

#include "www.h"

namespace update_http
{

namespace
{
constexpr size_t CHUNK = 2048;
uint8_t chunk[CHUNK];
} // namespace

Outcome stream_install(install_target::Target target, const zenit::update::Manifest &manifest, Read read, void *source,
                       Progress progress, Stop stop)
{
  using install_target::Target;
  const uint32_t size = manifest.size;
  if (!install_target::begin(target, manifest))
    // A page still being sent that the install could not wait for is a busy board, tried again later like a network
    // that did not answer, not a failing flash.
    return target == Target::Web && www::install_busy() ? Outcome::Unreachable : Outcome::FlashError;
  zenit::net::Sha256 hash;
  uint32_t received = 0;
  int last_percent = -1;
  Outcome outcome = Outcome::Ok;
  while (received < size)
  {
    if (stop && stop())
    {
      outcome = Outcome::Unreachable;
      break;
    }
    const size_t want = size - received < CHUNK ? size - received : CHUNK;
    const int got = read(source, chunk, want);
    if (got < 0)
    {
      outcome = Outcome::Unreachable;
      break;
    }
    if (got == 0)
    {
      // The source ended before the size the manifest promised.
      outcome = Outcome::BadDownload;
      break;
    }
    if (!install_target::write(target, chunk, static_cast<size_t>(got)))
    {
      // An image whose header is not the one offered is a bad download: nothing was erased.
      outcome = target == Target::Web && www::install_refused() ? Outcome::BadDownload : Outcome::FlashError;
      break;
    }
    hash.update(chunk, static_cast<size_t>(got));
    received += static_cast<uint32_t>(got);
    const int percent = static_cast<int>(static_cast<uint64_t>(received) * 100 / size);
    if (progress && percent != last_percent)
    {
      progress(static_cast<uint8_t>(percent));
      last_percent = percent;
    }
  }
  // The file must end where the manifest says.
  if (outcome == Outcome::Ok && read(source, chunk, 1) > 0)
    outcome = Outcome::BadDownload;
  if (outcome != Outcome::Ok)
  {
    install_target::abort(target);
    return outcome;
  }
  uint8_t digest[zenit::net::SHA256_SIZE];
  char hex[zenit::net::SHA256_HEX + 1];
  const bool hashed = hash.finish(digest);
  if (hashed)
    zenit::net::to_hex(digest, hex);
  if (!hashed || std::strcmp(hex, manifest.sha256) != 0)
  {
    install_target::abort(target);
    return Outcome::BadDownload;
  }
  return install_target::end(target) ? Outcome::Ok : Outcome::FlashError;
}

} // namespace update_http
