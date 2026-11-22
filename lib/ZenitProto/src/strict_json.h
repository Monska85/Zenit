// SPDX-License-Identifier: GPL-3.0-or-later

// The strict JSON check of docs/protocol/protocol-v1.md#lines, run before ArduinoJson parses a request. ArduinoJson
// accepts more than RFC 8259 (comments, single quotes, unquoted keys, a leading +), and the protocol does not.

#pragma once

#include <cstddef>

namespace zenit
{
namespace proto
{

// Checks that `json` is one JSON object and nothing else: valid UTF-8, no byte order mark, nothing after the object,
// no control character inside a string, no newline or carriage return anywhere (only a space or a tab between tokens),
// no invalid escape, no U+0000 (raw or as \u0000), no unpaired escaped surrogate, no object that names a key twice
// (keys compared after their escapes are decoded), and at most `max_depth` levels of nesting (at most 32). More than
// 192 keys at once is refused, which a line within the protocol's limit cannot reach. Linear time, allocates nothing.
// On failure it returns false and sets `reason` (a static text) and `offset` (the byte where the problem was found).
bool check_strict_object(const char *json, size_t length, int max_depth, const char *&reason, size_t &offset);

} // namespace proto
} // namespace zenit
