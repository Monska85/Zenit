// SPDX-License-Identifier: GPL-3.0-or-later

// What the board's HTTP server answers (docs/board/wifi-and-updates-v1.md#the-served-web-app): the routes, the
// headers of every answer and the files of the embedded web app.

#pragma once

#include <cstddef>
#include <cstdint>

namespace zenit
{
namespace net
{

// One file of the embedded web app: its path without the leading slash, its media type, its gzipped bytes.
struct Asset
{
  const char *path;
  const char *content_type;
  const uint8_t *data;
  size_t size;
  // Names that carry a content hash can be cached for a year.
  bool immutable;
};

constexpr size_t MAX_PATH = 128;

enum class Route : uint8_t
{
  Asset,
  BoardJson,
  NotFound
};

struct Resolved
{
  Route route = Route::NotFound;
  const Asset *asset = nullptr;
};

// Finds what a request path (as the server gives it, with any query) names. `/` is `index.html`; `/board.json` is the
// board's own answer; a path that is not an embedded file is not found, and so is one with `..`, a backslash or a
// byte outside printable ASCII.
Resolved resolve(const Asset *assets, size_t count, const char *uri);

struct Header
{
  const char *name;
  const char *value;
};

// The headers every answer carries.
extern const Header COMMON_HEADERS[];
extern const size_t COMMON_HEADER_COUNT;

// `Cache-Control` of an asset.
const char *cache_control(const Asset &asset);

// The body of `/board.json` for `hostname`, a NUL-terminated string. Returns its length, or 0 when it does not fit.
size_t board_json(const char *hostname, char *out, size_t size);

} // namespace net
} // namespace zenit
