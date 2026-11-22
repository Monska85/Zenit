// SPDX-License-Identifier: GPL-3.0-or-later

// The memory under the settings: NVS on the board, a map in the simulator. Each record is one blob, written in one
// step, so a power cut during a save leaves either the old record or the new one.

#pragma once

#include <cstddef>
#include <cstdint>

namespace settings
{
namespace store
{

// False when the memory could not be opened.
bool begin();
// The size of the stored record (at most `capacity` bytes are copied into `out`), or 0 when it is missing or
// unreadable.
size_t read(const char *key, uint8_t *out, size_t capacity);
// False when the record could not be saved; the stored record is then the old one.
bool write(const char *key, const uint8_t *data, size_t size);

} // namespace store
} // namespace settings
