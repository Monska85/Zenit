// SPDX-License-Identifier: GPL-3.0-or-later

// Favorites as protocol JSON (docs/protocol/protocol-v1.md#favorites): the checks of the request fields and the list
// every favorites reply holds.

#pragma once

#include <ArduinoJson.h>
#include <favorites.h>

#include "request.h"

namespace zenit
{
namespace proto
{

// `id`: a whole number from 1 to 255, else `bad_request`. `allow_null`: `null` is read as NO_FAVORITE (favorite_start).
Failure read_favorite_id(JsonVariantConst value, uint8_t &id, bool allow_null = false);
// `name`: text, else `bad_request`; a text that breaks the name rules is `bad_name`. `name` points into the request.
Failure read_favorite_name(JsonVariantConst value, const char *&name);
// The error of a favorites operation that did not succeed; no failure for Ok.
Failure favorite_failure(FavoriteResult result);
// Writes `favorites` (in saved order, each with `id`, `name`, `effect`, `brightness` and the settings its effect reads,
// in the order of `info.effect_settings`) and `start` (an id, or null).
void write_favorites(JsonObject reply, const Favorites &favorites);

} // namespace proto
} // namespace zenit
