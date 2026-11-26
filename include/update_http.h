// SPDX-License-Identifier: GPL-3.0-or-later

// What the update checks and downloads need from the network (docs/board/wifi-and-updates-v1.md#transport): HTTPS with
// the certificate bundle on the board, a scripted source in the simulator.

#pragma once

#include <cstddef>
#include <cstdint>

#include <manifest.h>

#include "install_target.h"

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

// Streams the file at `url` into `target` (the inactive slot or the `www` partition), hashing it, and checks the size
// and SHA-256 of `manifest`. `progress` is called with a whole percentage when it changes. `stop`, when given, is asked
// before each piece: true ends the transfer as Unreachable, and the target's install is aborted.
using Progress = void (*)(uint8_t percent);
using Stop = bool (*)();
Outcome download(install_target::Target target, const char *url, const zenit::update::Manifest &manifest,
                 Progress progress, Stop stop = nullptr);

// The part of `download` shared by both transports. `read` puts the next bytes of `source` into `out`, at most
// `capacity`: it returns how many, 0 at the end of the file, or a negative number when the transfer failed
// (Unreachable). Installs `manifest.size` bytes into `target`, then checks that the file ends there and that its
// SHA-256 is the manifest's. Any failure aborts the target's install.
using Read = int (*)(void *source, uint8_t *out, size_t capacity);
Outcome stream_install(install_target::Target target, const zenit::update::Manifest &manifest, Read read, void *source,
                       Progress progress, Stop stop);

#ifdef ZENIT_SIM
// Simulator: scripts the source, per target: the firmware manifest and file, or the web ones (a manifest URL that ends
// in `web/update.json` is the web one).
using install_target::Target;
void sim_set_manifest(Target target, const char *body);             // served as it is
void sim_set_manifest_outcome(Target target, Outcome outcome);      // fails the manifest instead
void sim_set_file(Target target, const uint8_t *data, size_t size); // the file served
void sim_set_download_outcome(Target target, Outcome outcome);      // fails the download instead
size_t sim_manifest_reads(Target target);                           // the manifests of `target` read since the reset
// The firmware manifest fails as unreachable; the web manifest offers the image the simulator's partition starts with.
void sim_reset();
#endif

} // namespace update_http
