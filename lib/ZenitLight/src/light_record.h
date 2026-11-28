// SPDX-License-Identifier: GPL-3.0-or-later

// The stored form of the light settings (docs/board/light-v1.md#stored-settings): one record of LIGHT_RECORD_SIZE
// bytes, written in one step.

#pragma once

#include <cstddef>
#include <cstdint>

#include "light_settings.h"

namespace zenit
{

constexpr uint8_t LIGHT_RECORD_VERSION = 2;
constexpr size_t LIGHT_RECORD_SIZE = 18;
// Version 1, written by firmware 1.1.0 and earlier: the first 17 bytes of version 2, read with the default pattern.
constexpr size_t LIGHT_RECORD_V1_SIZE = 17;

void encode_light_record(const LightSettings &settings, uint8_t (&out)[LIGHT_RECORD_SIZE]);

// The settings of a record of version 2, or of version 1 (every value kept, the default pattern). A record of another
// size or version gives the defaults; a field out of its range keeps its default.
LightSettings decode_light_record(const uint8_t *record, size_t size);

// Whether `record` (`size` bytes) is a light record of the current version whose effect code this firmware knows.
bool light_record_is_current(const uint8_t *record, size_t size);

// The size of the light record at the start of a settings blob of `size` bytes whose other part is `other_size` bytes
// (the board record): LIGHT_RECORD_SIZE for a version 2 record, LIGHT_RECORD_V1_SIZE for a version 1 record, 0 when the
// blob is damaged (another size, or a size that does not match its version).
size_t light_record_size_in_blob(const uint8_t *blob, size_t size, size_t other_size);

} // namespace zenit
