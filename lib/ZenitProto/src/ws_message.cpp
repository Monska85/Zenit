// SPDX-License-Identifier: GPL-3.0-or-later

#include "ws_message.h"

#include <cstring>

#include <utf8.h>

namespace zenit
{
namespace proto
{

MessageAssembler::Result MessageAssembler::close(uint16_t code)
{
  code_ = code;
  reset();
  return Result::Close;
}

void MessageAssembler::reset()
{
  size_ = 0;
  in_message_ = false;
  binary_ = false;
  buffer_[0] = 0;
}

MessageAssembler::Result MessageAssembler::begin_frame(FrameKind kind, size_t payload_size)
{
  if (kind == FrameKind::Continuation ? !in_message_ : in_message_)
    return close(CLOSE_PROTOCOL_ERROR);
  if (kind != FrameKind::Continuation)
  {
    in_message_ = true;
    binary_ = kind == FrameKind::Binary;
    size_ = 0;
  }
  if (size_ + payload_size > MAX_LINE)
    return close(CLOSE_TOO_BIG);
  return Result::More;
}

MessageAssembler::Result MessageAssembler::end_frame(bool final, const uint8_t *payload, size_t payload_size)
{
  if (payload_size > 0)
    std::memcpy(buffer_ + size_, payload, payload_size);
  size_ += payload_size;
  if (!final)
    return Result::More;
  const bool binary = binary_;
  in_message_ = false;
  if (binary)
    return close(CLOSE_UNSUPPORTED);
  buffer_[size_] = 0;
  for (size_t i = 0; i < size_; i++)
    if (buffer_[i] == '\n')
      return close(CLOSE_POLICY);
  for (size_t i = 0; i < size_;)
  {
    const size_t length = net::utf8_sequence_length(line(), size_, i);
    if (length == 0)
      return close(CLOSE_INVALID_PAYLOAD);
    i += length;
  }
  return Result::Line;
}

} // namespace proto
} // namespace zenit
