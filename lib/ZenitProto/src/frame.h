// SPDX-License-Identifier: GPL-3.0-or-later

// The line framing of docs/protocol/protocol-v1.md#lines: `@ZN <crc> <json>`.

#pragma once

#include <cstddef>
#include <cstdint>

namespace zenit
{
namespace proto
{

constexpr char FRAME_MARKER[] = "@ZN ";
constexpr size_t FRAME_MARKER_SIZE = 4;
constexpr size_t CRC_DIGITS = 8;
// Marker, 8 digits and the space before the JSON.
constexpr size_t FRAME_HEAD_SIZE = FRAME_MARKER_SIZE + CRC_DIGITS + 1;

// Whether the line starts with the protocol marker.
bool has_marker(const char *line, size_t length);

enum class FrameStatus
{
  NotProtocol, // no marker: the board ignores the line
  Malformed,   // marker, but the checksum is missing, not 8 lowercase hexadecimal digits, or the JSON is empty
  BadCrc,      // well formed, but the checksum does not match
  Ok
};

struct Frame
{
  const char *json = nullptr; // points into the line
  size_t json_length = 0;
  uint32_t crc = 0;
};

// Splits and checks a line (without its newline). `frame` is set only for Ok.
FrameStatus parse_frame(const char *line, size_t length, Frame &frame);

// Writes `@ZN <crc> <json>` and a terminating newline into `out`. Returns the bytes written, or 0 when the line does
// not fit in `capacity`. `json` must not overlap `out`.
size_t format_frame(char *out, size_t capacity, const char *json, size_t json_length);

// The same for a JSON text already written at `line + FRAME_HEAD_SIZE`: fills in the marker and the checksum before it
// and the newline after it. `line` must have room for FRAME_HEAD_SIZE + json_length + 1 bytes. Returns that size.
size_t seal_frame(char *line, size_t json_length);

} // namespace proto
} // namespace zenit
