// SPDX-License-Identifier: GPL-3.0-or-later

// What the board's HTTP server answers (docs/board/wifi-and-updates-v1.md#the-served-web-app): the routes, the
// headers of every answer and the files of the web app, read from the web image.

#pragma once

#include <cstddef>
#include <cstdint>

namespace zenit
{
namespace net
{

// One file of the web app, in the web image: its path without the leading slash, its media type, its gzipped bytes.
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
// board's own answer; a path that is not a file of the web app is not found, and so is one with `..`, a backslash or a
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

// The page the board serves instead of the web app while the app is not usable (installing, missing or incompatible):
// at most MAX_EMERGENCY_PAGE bytes, no script, it reloads itself every 30 seconds. `repairing` says the board is
// installing the app or will try again; otherwise web updates are off and the page names the site to install it from
// over USB. Returns its length, or 0 when it does not fit.
constexpr size_t MAX_EMERGENCY_PAGE = 4096;
size_t emergency_page(bool repairing, const char *site_url, char *out, size_t size);

} // namespace net
} // namespace zenit
