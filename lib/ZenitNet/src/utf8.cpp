// SPDX-License-Identifier: GPL-3.0-or-later

#include "utf8.h"

namespace zenit
{
namespace net
{

namespace
{
bool continuation(const char *text, size_t length, size_t index)
{
  return index < length && (static_cast<unsigned char>(text[index]) & 0xC0) == 0x80;
}
} // namespace

size_t utf8_sequence_length(const char *text, size_t length, size_t index)
{
  if (index >= length)
    return 0;
  const unsigned char lead = static_cast<unsigned char>(text[index]);
  if (lead < 0x80)
    return 1;
  if (lead >= 0xC2 && lead <= 0xDF)
    return continuation(text, length, index + 1) ? 2 : 0;
  if (lead >= 0xE0 && lead <= 0xEF)
  {
    if (!continuation(text, length, index + 1) || !continuation(text, length, index + 2))
      return 0;
    const unsigned char second = static_cast<unsigned char>(text[index + 1]);
    if (lead == 0xE0 && second < 0xA0) // overlong
      return 0;
    if (lead == 0xED && second > 0x9F) // surrogate
      return 0;
    return 3;
  }
  if (lead >= 0xF0 && lead <= 0xF4)
  {
    if (!continuation(text, length, index + 1) || !continuation(text, length, index + 2) ||
        !continuation(text, length, index + 3))
      return 0;
    const unsigned char second = static_cast<unsigned char>(text[index + 1]);
    if (lead == 0xF0 && second < 0x90) // overlong
      return 0;
    if (lead == 0xF4 && second > 0x8F) // above U+10FFFF
      return 0;
    return 4;
  }
  return 0;
}

} // namespace net
} // namespace zenit
