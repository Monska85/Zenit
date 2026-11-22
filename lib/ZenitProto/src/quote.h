// SPDX-License-Identifier: GPL-3.0-or-later

// Request text quoted in a reply (docs/protocol/protocol-v1.md#lines): every byte that is not part of a well-formed
// UTF-8 sequence becomes U+FFFD, and control characters are written as `\u00XX` text, so a reply is always valid UTF-8
// and ArduinoJson never writes a raw control character.

#pragma once

#include <cstddef>

namespace zenit
{
namespace proto
{

// Writes the quoted text into `out` followed by a NUL, never more than `capacity` bytes, cutting after the last whole
// character or escape that fits. Returns the length written, without the NUL. `capacity` must be at least 1.
size_t quote_text(const char *text, size_t length, char *out, size_t capacity);

} // namespace proto
} // namespace zenit
