// SPDX-License-Identifier: GPL-3.0-or-later

#include "crc32.h"

namespace zenit
{
namespace proto
{

namespace
{
// The reflected polynomial one nibble at a time: 64 bytes of table instead of 1 KiB.
const uint32_t NIBBLE_TABLE[16] = {0x00000000, 0x1DB71064, 0x3B6E20C8, 0x26D930AC, 0x76DC4190, 0x6B6B51F4,
                                   0x4DB26158, 0x5005713C, 0xEDB88320, 0xF00F9344, 0xD6D6A3E8, 0xCB61B38C,
                                   0x9B64C2B0, 0x86D3D2D4, 0xA00AE278, 0xBDBDF21C};
} // namespace

uint32_t crc32(const void *data, size_t length)
{
  const uint8_t *bytes = static_cast<const uint8_t *>(data);
  uint32_t crc = 0xFFFFFFFFu;
  for (size_t i = 0; i < length; i++)
  {
    crc ^= bytes[i];
    crc = (crc >> 4) ^ NIBBLE_TABLE[crc & 0x0F];
    crc = (crc >> 4) ^ NIBBLE_TABLE[crc & 0x0F];
  }
  return crc ^ 0xFFFFFFFFu;
}

} // namespace proto
} // namespace zenit
