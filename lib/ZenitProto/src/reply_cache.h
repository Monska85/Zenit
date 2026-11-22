// SPDX-License-Identifier: GPL-3.0-or-later

// The last reply of one transport, with the `seq` and the CRC of the request it answered
// (docs/protocol/protocol-v1.md#retries): the same request again gets the same reply without running twice.

#pragma once

#include <cstddef>
#include <cstdint>

#include "proto_limits.h"

namespace zenit
{
namespace proto
{

class ReplyCache
{
public:
  void clear() { valid_ = false; }

  // The remembered reply line (with its newline) when it answered a request with this `seq` and `crc`, else null.
  const char *find(uint32_t seq, uint32_t crc, size_t &length) const
  {
    if (!valid_ || seq_ != seq || crc_ != crc)
      return nullptr;
    length = length_;
    return line_;
  }

  // Remembers `line` as the reply to the request (seq, crc). False, and nothing remembered, when it does not fit.
  bool store(uint32_t seq, uint32_t crc, const char *line, size_t length);

private:
  bool valid_ = false;
  uint32_t seq_ = 0;
  uint32_t crc_ = 0;
  size_t length_ = 0;
  char line_[MAX_REPLY_LINE + 1];
};

} // namespace proto
} // namespace zenit
