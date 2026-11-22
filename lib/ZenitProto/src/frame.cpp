// SPDX-License-Identifier: GPL-3.0-or-later

#include "frame.h"

#include <cstring>

#include "crc32.h"

namespace zenit
{
namespace proto
{

bool has_marker(const char *line, size_t length)
{
  return length >= FRAME_MARKER_SIZE && std::memcmp(line, FRAME_MARKER, FRAME_MARKER_SIZE) == 0;
}

FrameStatus parse_frame(const char *line, size_t length, Frame &frame)
{
  if (!has_marker(line, length))
    return FrameStatus::NotProtocol;
  if (length <= FRAME_HEAD_SIZE || line[FRAME_HEAD_SIZE - 1] != ' ')
    return FrameStatus::Malformed;
  uint32_t crc = 0;
  for (size_t i = 0; i < CRC_DIGITS; i++)
  {
    const char c = line[FRAME_MARKER_SIZE + i];
    uint32_t nibble;
    if (c >= '0' && c <= '9')
      nibble = static_cast<uint32_t>(c - '0');
    else if (c >= 'a' && c <= 'f')
      nibble = static_cast<uint32_t>(c - 'a' + 10);
    else
      return FrameStatus::Malformed;
    crc = (crc << 4) | nibble;
  }
  const char *json = line + FRAME_HEAD_SIZE;
  const size_t json_length = length - FRAME_HEAD_SIZE;
  if (crc32(json, json_length) != crc)
    return FrameStatus::BadCrc;
  frame.json = json;
  frame.json_length = json_length;
  frame.crc = crc;
  return FrameStatus::Ok;
}

size_t seal_frame(char *line, size_t json_length)
{
  static const char HEX[] = "0123456789abcdef";
  const uint32_t crc = crc32(line + FRAME_HEAD_SIZE, json_length);
  std::memcpy(line, FRAME_MARKER, FRAME_MARKER_SIZE);
  for (size_t i = 0; i < CRC_DIGITS; i++)
    line[FRAME_MARKER_SIZE + i] = HEX[(crc >> (28 - 4 * i)) & 0xF];
  line[FRAME_HEAD_SIZE - 1] = ' ';
  const size_t total = FRAME_HEAD_SIZE + json_length + 1;
  line[total - 1] = '\n';
  return total;
}

size_t format_frame(char *out, size_t capacity, const char *json, size_t json_length)
{
  const size_t total = FRAME_HEAD_SIZE + json_length + 1;
  if (total > capacity)
    return 0;
  std::memcpy(out + FRAME_HEAD_SIZE, json, json_length);
  return seal_frame(out, json_length);
}

} // namespace proto
} // namespace zenit
