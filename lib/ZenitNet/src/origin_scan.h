// SPDX-License-Identifier: GPL-3.0-or-later

// Reads the `Origin` header of a WebSocket handshake from the raw bytes of the request
// (docs/board/wifi-and-updates-v1.md#websocket). The board's HTTP server answers the handshake by itself and never
// shows it to a handler, so the board reads the header on the way in.

#pragma once

#include <cstddef>

namespace zenit
{
namespace net
{

class OriginScan
{
public:
  // The longest origin kept; a longer one is not a valid origin.
  static constexpr size_t MAX_ORIGIN = 255;

  // Starts over, for a new connection.
  void reset();
  // Reads the next bytes of the request. Bytes after the end of the headers are left alone.
  void feed(const char *data, size_t size);
  // The headers ended (an empty line).
  bool done() const { return done_; }
  // The request had no `Origin` header.
  bool missing() const { return count_ == 0 && !bad_; }
  // The request had one `Origin` header of at most MAX_ORIGIN characters: its value, without surrounding spaces.
  // Null when there was none, more than one, or a value too long.
  const char *origin() const { return count_ == 1 && !bad_ ? value_ : nullptr; }

private:
  void end_line();

  // The start of the current line, enough to tell an `Origin` line and keep its value.
  static constexpr size_t LINE_SIZE = MAX_ORIGIN + 16;
  char line_[LINE_SIZE];
  size_t length_ = 0;
  bool overflow_ = false;
  bool first_line_ = true;
  bool done_ = false;
  int count_ = 0;
  bool bad_ = false;
  char value_[MAX_ORIGIN + 1] = {};
};

} // namespace net
} // namespace zenit
