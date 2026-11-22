// SPDX-License-Identifier: GPL-3.0-or-later

// Collects bytes into lines for the USB serial port and the simulator's standard input
// (docs/protocol/protocol-v1.md#lines). A line longer than the limit is consumed up to its newline; it is reported only
// when it started with the protocol marker, since the board ignores every other line.

#pragma once

#include <cstddef>
#include <cstdint>

#include "proto_limits.h"

namespace zenit
{
namespace proto
{

class LineReader
{
public:
  // `strip_carriage_return`: take off the one `\r` before the newline, as a serial port needs. A WebSocket message has
  // no line ending, so a reader standing in for one keeps every `\r`.
  explicit LineReader(bool strip_carriage_return = true) : strip_cr_(strip_carriage_return) {}

  enum class Event
  {
    None,
    Line,   // line() and length() hold a complete line, without its newline
    TooLong // a line that starts with the marker was longer than MAX_LINE; it has been dropped
  };

  Event feed(uint8_t byte);
  // The last complete line, valid until the next feed(). A `\r` before the newline is not part of it.
  const char *line() const { return line_; }
  size_t length() const { return length_; }
  void clear();

private:
  // Room for the `\r` after the longest line, and a NUL.
  char line_[MAX_LINE + 2];
  size_t length_ = 0;
  bool strip_cr_;
  bool overflowed_ = false;
  bool marker_ = false;
  bool complete_ = false; // the last feed() ended a line: the next one starts afresh
};

} // namespace proto
} // namespace zenit
