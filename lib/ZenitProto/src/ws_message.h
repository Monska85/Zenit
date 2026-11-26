// SPDX-License-Identifier: GPL-3.0-or-later

// The rules for the messages of a WebSocket (docs/protocol/protocol-v1.md#websocket): one protocol line per text
// message, reassembled from fragments, at most MAX_LINE bytes.

#pragma once

#include <cstddef>
#include <cstdint>

#include "proto_limits.h"

namespace zenit
{
namespace proto
{

// WebSocket close status codes (RFC 6455) the board uses.
constexpr uint16_t CLOSE_NORMAL = 1000;
constexpr uint16_t CLOSE_PROTOCOL_ERROR = 1002;
constexpr uint16_t CLOSE_UNSUPPORTED = 1003;
constexpr uint16_t CLOSE_INVALID_PAYLOAD = 1007;
constexpr uint16_t CLOSE_POLICY = 1008;
constexpr uint16_t CLOSE_TOO_BIG = 1009;
constexpr uint16_t CLOSE_INTERNAL_ERROR = 1011;
constexpr uint16_t CLOSE_TRY_LATER = 1013;
// The board installed a new web app: the page reloads to load it.
constexpr uint16_t CLOSE_RELOAD = 1012;

enum class FrameKind : uint8_t
{
  Continuation = 0,
  Text = 1,
  Binary = 2
};

// Collects the data frames of one message at a time. Control frames are not its business.
class MessageAssembler
{
public:
  enum class Result : uint8_t
  {
    More, // the message goes on
    Line, // line() holds a complete text message
    Close // close the connection with code()
  };

  // Call when a frame header has been read and before its payload is read: refuses a frame that breaks the sequence
  // of a message (1002) or takes the message over the limit (1009), so a payload that is too long is never read.
  Result begin_frame(FrameKind kind, size_t payload_size);

  // Adds the payload of the frame `begin_frame` accepted. `final` is the FIN bit. A complete text message must be
  // valid UTF-8 (1007) and hold no newline (1008); a complete binary message is refused (1003). A payload that would
  // take the message over the limit, or a call with no frame begun, closes with 1009 and copies nothing.
  Result end_frame(bool final, const uint8_t *payload, size_t payload_size);

  const char *line() const { return reinterpret_cast<const char *>(buffer_); }
  size_t line_size() const { return size_; }
  uint16_t code() const { return code_; }

  void reset();

private:
  Result close(uint16_t code);

  uint8_t buffer_[MAX_LINE + 1] = {}; // the extra byte keeps line() a C string
  size_t size_ = 0;
  bool in_message_ = false;
  bool binary_ = false;
  uint16_t code_ = 0;
};

} // namespace proto
} // namespace zenit
