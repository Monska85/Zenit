// SPDX-License-Identifier: GPL-3.0-or-later

// The update transfers as the network task runs them: read the manifest, download the firmware. Shared by the board's
// network task and the simulator's stand-in, over update_http and firmware.

#pragma once

#include <manifest.h>
#include <update_status.h>

#include <cstdint>

#include "install_target.h"

namespace update_worker
{

struct CheckResult
{
  // Never: the manifest was read and is valid (`manifest` holds it); anything else is the failure.
  zenit::update::Result result = zenit::update::Result::Never;
  zenit::update::Manifest manifest;
};

// The manifest of `target`: the firmware's or the web app's rules.
CheckResult check(install_target::Target target, const char *manifest_url);

// Installed: the image is in the inactive slot, checked, and not yet activated. Anything else is the failure.
// For the web app, Installed means the image is written and reads.
zenit::update::Result download(install_target::Target target, const char *manifest_url,
                               const zenit::update::Manifest &manifest, void (*progress)(uint8_t percent));

} // namespace update_worker
