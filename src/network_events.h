// SPDX-License-Identifier: GPL-3.0-or-later

// What the network task tells the loop task about the update transfers (the same queue entry on the board and in
// the simulator).

#pragma once

#include <manifest.h>
#include <update_status.h>

#include <cstdint>

#include "install_target.h"

namespace network
{

struct UpdateEvent
{
  enum class Type : uint8_t
  {
    Manifest,  // `result` Never: `manifest` is valid; otherwise the failure
    Downloaded // `result` Installed: the image is ready; otherwise the failure
  };
  Type type = Type::Manifest;
  install_target::Target target = install_target::Target::Firmware;
  zenit::update::Result result = zenit::update::Result::Never;
  zenit::update::Manifest manifest;
};

} // namespace network
