// SPDX-License-Identifier: GPL-3.0-or-later

#include "reply_cache.h"

#include <cstring>

namespace zenit
{
namespace proto
{

bool ReplyCache::store(uint32_t seq, uint32_t crc, const char *line, size_t length)
{
  valid_ = false;
  if (length > sizeof(line_))
    return false;
  std::memcpy(line_, line, length);
  length_ = length;
  seq_ = seq;
  crc_ = crc;
  valid_ = true;
  return true;
}

} // namespace proto
} // namespace zenit
