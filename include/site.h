// SPDX-License-Identifier: GPL-3.0-or-later

// The project's site address, set when the firmware is built (tools/site_url.py): where the update manifest is and
// the origin the WebSocket accepts.

#pragma once

#ifndef ZENIT_SITE_URL
#define ZENIT_SITE_URL "https://monska85.github.io/Zenit/"
#endif

#include <manifest.h>

namespace site
{
constexpr const char *URL = ZENIT_SITE_URL;
constexpr const char *MANIFEST_PATH = "firmware/update.json";
constexpr const char *WEB_MANIFEST_PATH = "web/update.json";
// The manifest and firmware URLs are built into buffers of MAX_URL characters: a longer address is a build error.
// The site's origin is the address without its path, so it fits the same number of characters, and a NUL.
constexpr size_t ORIGIN_SIZE = zenit::update::MAX_SITE_URL + 1;
static_assert(sizeof(ZENIT_SITE_URL) - 1 <= zenit::update::MAX_SITE_URL, "ZENIT_SITE_URL is too long");
} // namespace site
