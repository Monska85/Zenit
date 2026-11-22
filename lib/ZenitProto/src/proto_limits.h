// SPDX-License-Identifier: GPL-3.0-or-later

// The limits of docs/protocol/protocol-v1.md#limits. `info` reports MAX_LINE; the board, the simulator, the tools and
// the conformance cases must agree with it.

#pragma once

#include <cstddef>

namespace zenit
{
namespace proto
{

// The longest line the board reads, newline and a `\r` before it excluded.
constexpr size_t MAX_LINE = 1024;
// JSON nesting in a request.
constexpr int MAX_NESTING = 4;
// The longest reply line the board builds, marker and checksum included, newline excluded. Clients accept 4,096.
constexpr size_t MAX_REPLY_LINE = 1536;

} // namespace proto
} // namespace zenit
