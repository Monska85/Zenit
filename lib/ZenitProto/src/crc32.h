// SPDX-License-Identifier: GPL-3.0-or-later

// CRC-32 as zlib, PNG and Ethernet compute it: polynomial 0x04C11DB7 reflected, initial value and final XOR 0xFFFFFFFF.

#pragma once

#include <cstddef>
#include <cstdint>

namespace zenit
{
namespace proto
{

uint32_t crc32(const void *data, size_t length);

} // namespace proto
} // namespace zenit
