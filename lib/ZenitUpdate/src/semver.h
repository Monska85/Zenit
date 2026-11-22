// SPDX-License-Identifier: GPL-3.0-or-later

// Semantic versions (https://semver.org/), as the firmware version and the update manifest write them.

#pragma once

#include <cstddef>
#include <cstdint>

namespace zenit
{
namespace update
{

constexpr size_t MAX_VERSION = 47;

struct Version
{
  uint32_t major = 0, minor = 0, patch = 0;
  char prerelease[MAX_VERSION + 1] = {0};
};

// `X.Y.Z`, then optionally `-prerelease` and `+build` (the build part is read and dropped). Numbers have no leading
// zeros and at most 6 digits; identifiers are letters, digits and hyphens. False for anything else, or a text longer
// than MAX_VERSION.
bool parse_version(const char *text, Version &out);
// Whether `text` is a plain `X.Y.Z` release.
bool is_release(const char *text);

// -1, 0 or 1 by semantic versioning precedence (a prerelease is lower than its release; build metadata is ignored).
int compare_versions(const Version &a, const Version &b);

} // namespace update
} // namespace zenit
