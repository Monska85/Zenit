// SPDX-License-Identifier: GPL-3.0-or-later

#include "origin_scan.h"

#include <cstring>

namespace zenit
{
namespace net
{

namespace
{
char lower(char c) { return c >= 'A' && c <= 'Z' ? static_cast<char>(c - 'A' + 'a') : c; }
} // namespace

void OriginScan::reset() { *this = OriginScan(); }

void OriginScan::feed(const char *data, size_t size)
{
  for (size_t i = 0; i < size && !done_; i++)
  {
    const char c = data[i];
    if (c == '\n')
    {
      end_line();
      continue;
    }
    if (length_ < LINE_SIZE)
      line_[length_++] = c;
    else
      overflow_ = true;
  }
}

void OriginScan::end_line()
{
  size_t length = length_;
  if (length > 0 && line_[length - 1] == '\r' && !overflow_)
    length--;
  const bool empty = length == 0 && !overflow_;
  const bool first = first_line_;
  first_line_ = false;
  length_ = 0;
  const bool overflow = overflow_;
  overflow_ = false;
  if (first)
    return; // the request line
  if (empty)
  {
    done_ = true;
    return;
  }
  static const char NAME[] = "origin:";
  const size_t name_length = sizeof(NAME) - 1;
  if (length < name_length)
    return;
  for (size_t k = 0; k < name_length; k++)
    if (lower(line_[k]) != NAME[k])
      return;
  count_++;
  if (overflow)
  {
    bad_ = true;
    return;
  }
  size_t start = name_length, end = length;
  while (start < end && (line_[start] == ' ' || line_[start] == '\t'))
    start++;
  while (end > start && (line_[end - 1] == ' ' || line_[end - 1] == '\t'))
    end--;
  if (end - start > MAX_ORIGIN)
  {
    bad_ = true;
    return;
  }
  std::memcpy(value_, line_ + start, end - start);
  value_[end - start] = '\0';
}

} // namespace net
} // namespace zenit
