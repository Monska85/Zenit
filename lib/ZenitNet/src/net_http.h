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

// What the emergency page says: an install runs or a repair has a version to install; web updates are on but the site
// offers nothing this firmware can use yet; web updates are off.
enum class PageNote : uint8_t
{
  Installing,
  Waiting,
  Off
};

// The page the board serves instead of the web app while the app is not usable (installing, missing or incompatible):
// at most MAX_EMERGENCY_PAGE bytes, no script, it reloads itself every 30 seconds. `Installing` says the app is being
// installed; `Waiting` and `Off` say it is missing and name the site to install it from over USB (`Waiting` also says
// the board installs it by itself once the site offers a version for this firmware). Returns its length, or 0 when it
// does not fit.
constexpr size_t MAX_EMERGENCY_PAGE = 4096;
size_t emergency_page(PageNote note, const char *site_url, char *out, size_t size);

} // namespace net
} // namespace zenit
