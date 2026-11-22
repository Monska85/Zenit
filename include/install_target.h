// SPDX-License-Identifier: GPL-3.0-or-later

// Where a download goes: the inactive firmware slot or the `www` partition. The same four steps for both, so one
// download loop serves the two updates.

#pragma once

#include <cstddef>
#include <cstdint>

#include <manifest.h>

#include "firmware.h"
#include "www.h"

namespace install_target
{

enum class Target : uint8_t
{
  Firmware,
  Web
};

// `manifest` is the offer: its size, and for the web app the version the image's header must carry.
inline bool begin(Target target, const zenit::update::Manifest &manifest)
{
  return target == Target::Web ? www::begin_install(manifest.size, manifest.version)
                               : firmware::begin_install(manifest.size);
}
inline bool write(Target target, const uint8_t *data, size_t size)
{
  return target == Target::Web ? www::write(data, size) : firmware::write(data, size);
}
inline bool end(Target target) { return target == Target::Web ? www::end_install() : firmware::end_install(); }
inline void abort(Target target)
{
  if (target == Target::Web)
    www::abort_install();
  else
    firmware::abort_install();
}

} // namespace install_target
