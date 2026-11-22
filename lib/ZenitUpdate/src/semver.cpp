// SPDX-License-Identifier: GPL-3.0-or-later

#include "semver.h"

#include <cstring>

namespace zenit
{
namespace update
{

namespace
{
bool digit(char c) { return c >= '0' && c <= '9'; }
bool ident_char(char c) { return digit(c) || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '-'; }

bool read_number(const char *&p, uint32_t &out)
{
  const char *start = p;
  uint32_t value = 0;
  while (digit(*p))
  {
    value = value * 10 + static_cast<uint32_t>(*p - '0');
    if (++p - start > 6)
      return false;
  }
  if (p == start || (p - start > 1 && *start == '0'))
    return false;
  out = value;
  return true;
}

// Dot separated identifiers, none empty, numeric ones without leading zeros. Returns the end.
bool read_identifiers(const char *&p, char *out, size_t capacity)
{
  const char *start = p;
  bool empty = true;
  const char *id = p;
  for (;; p++)
  {
    if (*p == '.' || !ident_char(*p))
    {
      if (p == id)
        return false;
      bool numeric = true;
      for (const char *q = id; q < p; q++)
        numeric = numeric && digit(*q);
      if (numeric && p - id > 1 && *id == '0')
        return false;
      empty = false;
      if (*p != '.')
        break;
      id = p + 1;
    }
  }
  const size_t size = static_cast<size_t>(p - start);
  if (empty || size >= capacity)
    return false;
  if (out)
  {
    std::memcpy(out, start, size);
    out[size] = '\0';
  }
  return true;
}

// Compares two dot separated identifier lists by the precedence rules.
int compare_identifiers(const char *a, const char *b)
{
  for (;;)
  {
    const char *ea = a, *eb = b;
    while (*ea && *ea != '.')
      ea++;
    while (*eb && *eb != '.')
      eb++;
    bool na = true, nb = true;
    for (const char *q = a; q < ea; q++)
      na = na && digit(*q);
    for (const char *q = b; q < eb; q++)
      nb = nb && digit(*q);
    int order;
    if (na && nb)
    {
      const size_t la = static_cast<size_t>(ea - a), lb = static_cast<size_t>(eb - b);
      order = la != lb ? (la < lb ? -1 : 1) : std::strncmp(a, b, la);
    }
    else if (na != nb)
      order = na ? -1 : 1;
    else
    {
      const size_t la = static_cast<size_t>(ea - a), lb = static_cast<size_t>(eb - b);
      order = std::strncmp(a, b, la < lb ? la : lb);
      if (order == 0 && la != lb)
        order = la < lb ? -1 : 1;
    }
    if (order != 0)
      return order < 0 ? -1 : 1;
    if (!*ea || !*eb)
      return !*ea && !*eb ? 0 : (!*ea ? -1 : 1);
    a = ea + 1;
    b = eb + 1;
  }
}
} // namespace

bool parse_version(const char *text, Version &out)
{
  if (!text || std::strlen(text) > MAX_VERSION)
    return false;
  Version v;
  const char *p = text;
  if (!read_number(p, v.major) || *p++ != '.' || !read_number(p, v.minor) || *p++ != '.' || !read_number(p, v.patch))
    return false;
  if (*p == '-')
  {
    p++;
    if (!read_identifiers(p, v.prerelease, sizeof(v.prerelease)))
      return false;
  }
  if (*p == '+')
  {
    p++;
    // Build identifiers may have leading zeros.
    if (!*p)
      return false;
    for (; *p; p++)
      if (!ident_char(*p) && *p != '.')
        return false;
  }
  if (*p)
    return false;
  out = v;
  return true;
}

bool is_release(const char *text)
{
  Version v;
  return parse_version(text, v) && v.prerelease[0] == '\0' && !std::strchr(text, '+');
}

int compare_versions(const Version &a, const Version &b)
{
  if (a.major != b.major)
    return a.major < b.major ? -1 : 1;
  if (a.minor != b.minor)
    return a.minor < b.minor ? -1 : 1;
  if (a.patch != b.patch)
    return a.patch < b.patch ? -1 : 1;
  const bool pa = a.prerelease[0] != '\0', pb = b.prerelease[0] != '\0';
  if (pa != pb)
    return pa ? -1 : 1;
  return pa ? compare_identifiers(a.prerelease, b.prerelease) : 0;
}

} // namespace update
} // namespace zenit
