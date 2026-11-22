// SPDX-License-Identifier: GPL-3.0-or-later

// Well-formed UTF-8 (RFC 3629): no overlong form, no surrogate, nothing above U+10FFFF.

#pragma once

#include <cstddef>

namespace zenit
{
namespace proto
{

// The length of the well-formed UTF-8 sequence that starts at text[index], or 0 when the bytes there are not one.
size_t utf8_sequence_length(const char *text, size_t length, size_t index);

} // namespace proto
} // namespace zenit
