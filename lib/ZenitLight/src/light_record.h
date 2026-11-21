// SPDX-License-Identifier: GPL-3.0-or-later

// The stored form of the light settings (docs/board/light-v1.md#stored-settings): one record of LIGHT_RECORD_SIZE
// bytes, written in one step.

#pragma once

#include <cstddef>
#include <cstdint>

#include "light_settings.h"

namespace zenit
{

constexpr uint8_t LIGHT_RECORD_VERSION = 1;
constexpr size_t LIGHT_RECORD_SIZE = 17;

void encode_light_record(const LightSettings &settings, uint8_t (&out)[LIGHT_RECORD_SIZE]);

// The settings of a record. A record of another size or version gives the defaults; a field out of its range keeps
// its default.
LightSettings decode_light_record(const uint8_t *record, size_t size);

} // namespace zenit
