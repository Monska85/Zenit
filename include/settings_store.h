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

enum class Read : uint8_t
{
  Missing, // no record under the key: the caller may take defaults and write them
  Found,   // `size` is the stored record's size; at most `capacity` bytes were copied into `out`
  Failed   // the memory could not be read (or was not opened): the record may exist, so nothing may be written over it
};
Read read(const char *key, uint8_t *out, size_t capacity, size_t &size);
// False when the record could not be saved; the stored record is then the old one.
bool write(const char *key, const uint8_t *data, size_t size);

} // namespace store
} // namespace settings
