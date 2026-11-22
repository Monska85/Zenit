// SPDX-License-Identifier: GPL-3.0-or-later

#include "quote.h"

#include <cstdio>
#include <cstring>

#include <utf8.h>

namespace zenit
{
namespace proto
{

size_t quote_text(const char *text, size_t length, char *out, size_t capacity)
{
  size_t written = 0;
  const size_t room = capacity - 1;
  for (size_t i = 0; i < length;)
  {
    const unsigned char c = static_cast<unsigned char>(text[i]);
    const size_t sequence = net::utf8_sequence_length(text, length, i);
    if (sequence == 1 && c >= 0x20 && c != 0x7F)
    {
      if (written + 1 > room)
        break;
      out[written++] = static_cast<char>(c);
      i++;
    }
    else if (sequence == 1)
    {
      if (written + 6 > room)
        break;
      std::snprintf(out + written, 7, "\\u%04x", static_cast<unsigned>(c));
      written += 6;
      i++;
    }
    else if (sequence > 1)
    {
      if (written + sequence > room)
        break;
      std::memcpy(out + written, text + i, sequence);
      written += sequence;
      i += sequence;
    }
    else
    {
      if (written + 3 > room)
        break;
      std::memcpy(out + written, "\xEF\xBF\xBD", 3);
      written += 3;
      i++;
    }
  }
  out[written] = '\0';
  return written;
}

} // namespace proto
} // namespace zenit
