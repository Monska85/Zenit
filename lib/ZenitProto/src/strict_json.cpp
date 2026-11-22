// SPDX-License-Identifier: GPL-3.0-or-later

#include "strict_json.h"

#include <cstdint>
#include <cstring>

#include "utf8.h"

namespace zenit
{
namespace proto
{

namespace
{

// Keys remembered at once, which a line of 1,024 bytes cannot exceed: a key with its value takes 6 bytes at least.
constexpr size_t MAX_KEYS = 192;

enum class Expect : uint8_t
{
  Value,      // a value: after ':' or ','
  ValueOrEnd, // a value or ']': right after '['
  KeyOrEnd,   // a key or '}': right after '{'
  Key,        // a key: after ',' in an object
  Colon,
  AfterValue // ',' or the closing bracket of the container
};

bool is_digit(char c) { return c >= '0' && c <= '9'; }
bool is_hex(char c) { return is_digit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
// Between tokens only a space or a tab: a line holds no newline, and a carriage return is not part of the JSON.
bool is_space(char c) { return c == ' ' || c == '\t'; }

unsigned hex4(const char *digits)
{
  unsigned value = 0;
  for (int i = 0; i < 4; i++)
  {
    const char c = digits[i];
    const unsigned nibble = is_digit(c) ? static_cast<unsigned>(c - '0') : static_cast<unsigned>((c | 0x20) - 'a' + 10);
    value = value * 16 + nibble;
  }
  return value;
}

// Decodes the string whose content starts at `start` (just after its opening quote) to UTF-8 bytes, one at a time. The
// string has been checked, so its escapes are valid.
class KeyBytes
{
public:
  KeyBytes(const char *json, size_t start) : json_(json), i_(start) {}

  // The next byte, or -1 at the closing quote.
  int next()
  {
    if (pending_ > 0)
      return buffer_[count_ - pending_--];
    const char c = json_[i_++];
    if (c == '"')
      return -1;
    if (c != '\\')
      return static_cast<unsigned char>(c);
    const char e = json_[i_++];
    switch (e)
    {
    case 'b':
      return '\b';
    case 'f':
      return '\f';
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 't':
      return '\t';
    case 'u':
      break;
    default:
      return static_cast<unsigned char>(e); // " \ /
    }
    unsigned code = hex4(json_ + i_);
    i_ += 4;
    if (code >= 0xD800 && code <= 0xDBFF)
    {
      code = 0x10000 + ((code - 0xD800) << 10) + (hex4(json_ + i_ + 2) - 0xDC00);
      i_ += 6;
    }
    encode(code);
    return next();
  }

private:
  void encode(unsigned code)
  {
    if (code < 0x80)
    {
      buffer_[0] = static_cast<uint8_t>(code);
      count_ = 1;
    }
    else if (code < 0x800)
    {
      buffer_[0] = static_cast<uint8_t>(0xC0 | (code >> 6));
      buffer_[1] = static_cast<uint8_t>(0x80 | (code & 0x3F));
      count_ = 2;
    }
    else if (code < 0x10000)
    {
      buffer_[0] = static_cast<uint8_t>(0xE0 | (code >> 12));
      buffer_[1] = static_cast<uint8_t>(0x80 | ((code >> 6) & 0x3F));
      buffer_[2] = static_cast<uint8_t>(0x80 | (code & 0x3F));
      count_ = 3;
    }
    else
    {
      buffer_[0] = static_cast<uint8_t>(0xF0 | (code >> 18));
      buffer_[1] = static_cast<uint8_t>(0x80 | ((code >> 12) & 0x3F));
      buffer_[2] = static_cast<uint8_t>(0x80 | ((code >> 6) & 0x3F));
      buffer_[3] = static_cast<uint8_t>(0x80 | (code & 0x3F));
      count_ = 4;
    }
    pending_ = count_;
  }

  const char *json_;
  size_t i_;
  uint8_t buffer_[4] = {0, 0, 0, 0};
  uint8_t count_ = 0;
  uint8_t pending_ = 0;
};

// Whether the strings that start at `a` and `b` are the same text once their escapes are decoded.
bool same_key(const char *json, size_t a, size_t b)
{
  KeyBytes first(json, a), second(json, b);
  for (;;)
  {
    const int x = first.next(), y = second.next();
    if (x != y)
      return false;
    if (x < 0)
      return true;
  }
}

// The keys of the objects being read, as offsets of their text, so a key named twice in one object is found. Each open
// container remembers where its own keys start.
struct Keys
{
  uint16_t at[MAX_KEYS];
  size_t count = 0;
  size_t frame_start[32];
};

// The scanner state, so the string and number scans can be their own functions.
struct Scan
{
  const char *json;
  size_t length;
  size_t i = 0;
  const char *reason = nullptr;

  bool fail(const char *why)
  {
    reason = why;
    return false;
  }

  // From the opening quote to just after the closing one.
  bool string()
  {
    i++;
    for (;; i++)
    {
      if (i >= length)
        return fail("unterminated string");
      const unsigned char b = static_cast<unsigned char>(json[i]);
      if (b == '"')
        break;
      if (b < 0x20)
        return fail("control character inside a string");
      if (b == '\\')
      {
        if (!escape())
          return false;
      }
      else if (b >= 0x80)
      {
        const size_t n = utf8_sequence_length(json, length, i);
        if (n == 0)
          return fail("invalid UTF-8");
        i += n - 1;
      }
    }
    i++;
    return true;
  }

  // At a backslash; leaves i on the last byte of the escape.
  bool escape()
  {
    if (++i >= length)
      return fail("unterminated string");
    const char e = json[i];
    if (e != 'u')
    {
      if (e == '"' || e == '\\' || e == '/' || e == 'b' || e == 'f' || e == 'n' || e == 'r' || e == 't')
        return true;
      return fail("invalid escape");
    }
    if (i + 4 >= length)
      return fail("invalid escape");
    for (size_t k = 1; k <= 4; k++)
      if (!is_hex(json[i + k]))
        return fail("invalid escape");
    const unsigned code = hex4(json + i + 1);
    if (code == 0)
      return fail("U+0000 is not allowed in a string");
    i += 4;
    if (code >= 0xDC00 && code <= 0xDFFF)
      return fail("unpaired surrogate escape");
    if (code >= 0xD800 && code <= 0xDBFF)
    {
      // A high surrogate needs the escape of a low one right after it.
      if (i + 6 >= length || json[i + 1] != '\\' || json[i + 2] != 'u')
        return fail("unpaired surrogate escape");
      for (size_t k = 3; k <= 6; k++)
        if (!is_hex(json[i + k]))
          return fail("invalid escape");
      const unsigned low = hex4(json + i + 3);
      if (low < 0xDC00 || low > 0xDFFF)
        return fail("unpaired surrogate escape");
      i += 6;
    }
    return true;
  }

  void digits()
  {
    while (i < length && is_digit(json[i]))
      i++;
  }

  bool number()
  {
    if (json[i] == '-')
      i++;
    if (i >= length || !is_digit(json[i]))
      return fail("invalid number");
    if (json[i] == '0')
      i++;
    else
      digits();
    if (i < length && json[i] == '.')
    {
      i++;
      if (i >= length || !is_digit(json[i]))
        return fail("invalid number");
      digits();
    }
    if (i < length && (json[i] == 'e' || json[i] == 'E'))
    {
      i++;
      if (i < length && (json[i] == '+' || json[i] == '-'))
        i++;
      if (i >= length || !is_digit(json[i]))
        return fail("invalid number");
      digits();
    }
    return true;
  }

  bool literal(const char *word)
  {
    const size_t n = std::strlen(word);
    if (i + n > length || std::memcmp(json + i, word, n) != 0)
      return fail("invalid literal");
    i += n;
    return true;
  }
};

} // namespace

bool check_strict_object(const char *json, size_t length, int max_depth, const char *&reason, size_t &offset)
{
  if (max_depth > 32)
    max_depth = 32;
  Scan scan{json, length};
  Keys keys;
  uint32_t is_object = 0; // one bit per open container: 1 for an object, 0 for an array
  int depth = 0;
  Expect expect = Expect::Value;
  bool done = false;

  auto fail = [&](const char *why)
  {
    reason = why;
    offset = scan.i;
    return false;
  };

  while (scan.i < length)
  {
    const char c = json[scan.i];
    if (is_space(c))
    {
      scan.i++;
      continue;
    }
    if (done)
      return fail("data after the end of the document");
    if (depth == 0 && c != '{')
      return fail("the document is not an object");

    if (expect == Expect::AfterValue)
    {
      const bool in_object = (is_object >> (depth - 1)) & 1u;
      if (c == ',')
        expect = in_object ? Expect::Key : Expect::Value;
      else if ((c == '}' && in_object) || (c == ']' && !in_object))
      {
        depth--;
        keys.count = keys.frame_start[depth];
        done = depth == 0;
      }
      else
        return fail("unexpected character after a value");
      scan.i++;
      continue;
    }
    if (expect == Expect::Colon)
    {
      if (c != ':')
        return fail("expected ':' after a key");
      expect = Expect::Value;
      scan.i++;
      continue;
    }
    if ((expect == Expect::KeyOrEnd && c == '}') || (expect == Expect::ValueOrEnd && c == ']'))
    {
      depth--;
      keys.count = keys.frame_start[depth];
      done = depth == 0;
      expect = Expect::AfterValue;
      scan.i++;
      continue;
    }

    const bool is_key = expect == Expect::Key || expect == Expect::KeyOrEnd;
    if (is_key && c != '"')
      return fail("object keys must be double-quoted strings");

    if (c == '"')
    {
      const size_t text = scan.i + 1;
      if (!scan.string())
        return fail(scan.reason);
      if (is_key)
      {
        for (size_t k = keys.frame_start[depth - 1]; k < keys.count; k++)
          if (same_key(json, keys.at[k], text))
          {
            scan.i = text;
            return fail("a key is named twice in one object");
          }
        if (keys.count >= MAX_KEYS || text > UINT16_MAX)
        {
          scan.i = text;
          return fail("too many keys");
        }
        keys.at[keys.count++] = static_cast<uint16_t>(text);
      }
      expect = is_key ? Expect::Colon : Expect::AfterValue;
      continue;
    }
    if (c == '{' || c == '[')
    {
      if (depth >= max_depth)
        return fail("nested too deeply");
      if (c == '{')
        is_object |= 1u << depth;
      else
        is_object &= ~(1u << depth);
      keys.frame_start[depth] = keys.count;
      depth++;
      expect = c == '{' ? Expect::KeyOrEnd : Expect::ValueOrEnd;
      scan.i++;
      continue;
    }

    bool ok;
    if (c == 't')
      ok = scan.literal("true");
    else if (c == 'f')
      ok = scan.literal("false");
    else if (c == 'n')
      ok = scan.literal("null");
    else if (c == '-' || is_digit(c))
      ok = scan.number();
    else
      return fail("unexpected character");
    if (!ok)
      return fail(scan.reason);
    expect = Expect::AfterValue;
  }

  if (!done)
  {
    reason = length == 0 ? "empty document" : "unexpected end of the document";
    offset = length;
    return false;
  }
  return true;
}

} // namespace proto
} // namespace zenit
