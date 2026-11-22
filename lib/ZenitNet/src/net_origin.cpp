// SPDX-License-Identifier: GPL-3.0-or-later

#include "net_origin.h"

#include <cstring>

namespace zenit
{
namespace net
{

namespace
{
constexpr size_t MAX_ORIGIN = 255;

bool is_digit(char c) { return c >= '0' && c <= '9'; }

// Four decimal numbers from 0 to 255 without leading zeros, separated by dots.
bool parse_ipv4(const char *host, size_t size, unsigned out[4])
{
  size_t at = 0;
  for (int part = 0; part < 4; part++)
  {
    const size_t start = at;
    unsigned value = 0;
    while (at < size && is_digit(host[at]))
    {
      value = value * 10 + static_cast<unsigned>(host[at] - '0');
      if (++at - start > 3)
        return false;
    }
    const size_t digits = at - start;
    if (digits == 0 || (digits > 1 && host[start] == '0') || value > 255)
      return false;
    out[part] = value;
    if (part < 3)
    {
      if (at >= size || host[at] != '.')
        return false;
      at++;
    }
  }
  return at == size;
}

bool private_ipv4(const unsigned a[4])
{
  return a[0] == 10 || a[0] == 127 || (a[0] == 172 && a[1] >= 16 && a[1] <= 31) || (a[0] == 192 && a[1] == 168) ||
         (a[0] == 169 && a[1] == 254);
}

// Labels of lowercase letters, digits and hyphens, none empty, none starting or ending with a hyphen.
bool valid_name(const char *host, size_t size)
{
  size_t label = 0;
  for (size_t i = 0; i <= size; i++)
  {
    if (i == size || host[i] == '.')
    {
      if (label == 0 || host[i - 1] == '-')
        return false;
      label = 0;
      continue;
    }
    const char c = host[i];
    if (!((c >= 'a' && c <= 'z') || is_digit(c) || c == '-'))
      return false;
    if (label == 0 && c == '-')
      return false;
    label++;
  }
  return true;
}

bool valid_port(const char *port, size_t size)
{
  if (size == 0 || size > 5)
    return false;
  unsigned value = 0;
  for (size_t i = 0; i < size; i++)
  {
    if (!is_digit(port[i]))
      return false;
    value = value * 10 + static_cast<unsigned>(port[i] - '0');
  }
  return value <= 65535;
}

bool allowed_host(const char *host, size_t size)
{
  if (size == 9 && std::strncmp(host, "localhost", 9) == 0)
    return true;
  unsigned address[4];
  if (parse_ipv4(host, size, address))
    return private_ipv4(address);
  return size > 6 && std::strncmp(host + size - 6, ".local", 6) == 0 && valid_name(host, size);
}
} // namespace

bool site_origin_of(const char *site_url, char *out, size_t size)
{
  if (size > 0)
    out[0] = '\0';
  if (!site_url || std::strncmp(site_url, "https://", 8) != 0)
    return false;
  size_t end = 8;
  while (site_url[end] && site_url[end] != '/' && site_url[end] != '?' && site_url[end] != '#')
    end++;
  if (end <= 8 || end >= size)
    return false;
  for (size_t i = 0; i < end; i++)
    out[i] = (site_url[i] >= 'A' && site_url[i] <= 'Z') ? static_cast<char>(site_url[i] + 32) : site_url[i];
  out[end] = '\0';
  if (end > 12 && std::strcmp(out + end - 4, ":443") == 0)
    out[end - 4] = '\0';
  return true;
}

bool origin_allowed(const char *origin, const char *site_origin)
{
  if (!origin)
    return true;
  const size_t length = std::strlen(origin);
  if (length > MAX_ORIGIN)
    return false;
  if (site_origin && *site_origin && std::strcmp(origin, site_origin) == 0)
    return true;
  size_t scheme = 0;
  if (std::strncmp(origin, "http://", 7) == 0)
    scheme = 7;
  else if (std::strncmp(origin, "https://", 8) == 0)
    scheme = 8;
  else
    return false;
  const char *authority = origin + scheme;
  const size_t size = length - scheme;
  const char *colon = static_cast<const char *>(std::memchr(authority, ':', size));
  const size_t host_size = colon ? static_cast<size_t>(colon - authority) : size;
  if (colon && !valid_port(colon + 1, size - host_size - 1))
    return false;
  return allowed_host(authority, host_size);
}

} // namespace net
} // namespace zenit
