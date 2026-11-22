// SPDX-License-Identifier: GPL-3.0-or-later

#include "net_http.h"

#include <cstdio>
#include <cstring>

namespace zenit
{
namespace net
{

const Header COMMON_HEADERS[] = {
    {"Content-Security-Policy", "default-src 'self'; connect-src 'self' ws:; img-src 'self' data:; style-src 'self' "
                                "'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; "
                                "frame-ancestors 'none'"},
    {"X-Content-Type-Options", "nosniff"},
    {"Referrer-Policy", "no-referrer"},
    {"Cross-Origin-Resource-Policy", "same-origin"},
    {"Connection", "close"},
};
const size_t COMMON_HEADER_COUNT = sizeof(COMMON_HEADERS) / sizeof(COMMON_HEADERS[0]);

Resolved resolve(const Asset *assets, size_t count, const char *uri)
{
  Resolved none;
  if (!uri || uri[0] != '/')
    return none;
  size_t size = 0;
  while (uri[size] && uri[size] != '?' && uri[size] != '#')
    size++;
  if (size >= MAX_PATH)
    return none;
  char path[MAX_PATH];
  std::memcpy(path, uri + 1, size - 1);
  path[size - 1] = '\0';
  for (size_t i = 0; i + 1 < size; i++)
  {
    const unsigned char c = static_cast<unsigned char>(path[i]);
    if (c < 0x21 || c > 0x7e || c == '\\')
      return none;
  }
  if (std::strstr(path, ".."))
    return none;
  if (std::strcmp(path, "board.json") == 0)
  {
    Resolved found;
    found.route = Route::BoardJson;
    return found;
  }
  const char *wanted = size == 1 ? "index.html" : path;
  for (size_t i = 0; i < count; i++)
    if (std::strcmp(assets[i].path, wanted) == 0)
    {
      Resolved found;
      found.route = Route::Asset;
      found.asset = &assets[i];
      return found;
    }
  return none;
}

const char *cache_control(const Asset &asset)
{
  return asset.immutable ? "public, max-age=31536000, immutable" : "no-cache";
}

size_t board_json(const char *hostname, char *out, size_t size)
{
  const int written = std::snprintf(out, size, "{\"zenit\":true,\"hostname\":\"%s\",\"ws\":\"/ws\"}", hostname);
  return written > 0 && static_cast<size_t>(written) < size ? static_cast<size_t>(written) : 0;
}

} // namespace net
} // namespace zenit
