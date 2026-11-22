// SPDX-License-Identifier: GPL-3.0-or-later

// What the update checks and downloads need from the network (docs/board/wifi-and-updates-v1.md#transport): HTTPS with
// the certificate bundle on the board, a scripted source in the simulator.

#pragma once

#include <cstddef>
#include <cstdint>

namespace update_http
{

enum class Outcome : uint8_t
{
  Ok,
  Unreachable,
  NotPublished, // 404 or 403
  TlsError,
  BadDownload, // the wrong size or hash, or an early end
  FlashError
};

// Reads the manifest at `url` into `body` (at most `capacity` bytes; a longer one is BadDownload). `size` is its
// length.
Outcome fetch_manifest(const char *url, char *body, size_t capacity, size_t &size);

// Streams the file at `url` into the inactive slot (firmware::begin_install, write, end_install), hashing it, and
// checks size and SHA-256 (64 lowercase hexadecimal digits). `progress` is called with a whole percentage when it
// changes.
using Progress = void (*)(uint8_t percent);
Outcome download_firmware(const char *url, uint32_t size, const char *sha256, Progress progress);

#ifdef ZENIT_SIM
// Simulator: scripts the source.
void sim_set_manifest(const char *body);                 // served as it is
void sim_set_manifest_outcome(Outcome outcome);          // fails the manifest instead
void sim_set_firmware(const uint8_t *data, size_t size); // the file served
void sim_set_download_outcome(Outcome outcome);          // fails the download instead
void sim_reset();
#endif

} // namespace update_http
