// SPDX-License-Identifier: GPL-3.0-or-later

// The light settings as protocol JSON (docs/protocol/protocol-v1.md#settings_get-settings_set): reading a
// `settings_set` request, with a check of every field, and writing the `settings` object of a reply.

#pragma once

#include <ArduinoJson.h>
#include <board_settings.h>
#include <light_settings.h>

#include "request.h"

namespace zenit
{
namespace proto
{

// Applies the settings fields of `request` (every field but `seq` and `cmd`) to the light and board settings.
// `bad_request` when there is none, when a field is not a setting (the token is read only), or when a value has the
// wrong type, is `null` or is out of range. On failure both are left as they were: every field is checked before
// anything changes.
Failure apply_settings_request(JsonObjectConst request, LightSettings &light, net::BoardSettings &board);

// Writes every setting, in the order of the protocol's tables. The token is written only when `with_token` is set
// (a `settings_get` over USB).
void write_settings(JsonObject target, const LightSettings &light, const net::BoardSettings &board, bool with_token);

} // namespace proto
} // namespace zenit
