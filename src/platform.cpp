// SPDX-License-Identifier: GPL-3.0-or-later

#include "platform.h"

#include <cstring>

#ifndef ZENIT_VERSION
#define ZENIT_VERSION "0.0.0-unknown"
#endif
#ifndef ZENIT_BOARD
#define ZENIT_BOARD "unknown"
#endif

namespace platform
{

namespace
{
// The version is kept behind a marker, `ZENIT_VERSION=` then the version and its NUL, so the release check
// (tools/release_assets.py) finds this exact version in the image and not some other text that contains it. The
// version is read through the marker, which keeps the whole of it in the image.
constexpr char VERSION_MARKER[] = "ZENIT_VERSION=" ZENIT_VERSION;
constexpr size_t VERSION_PREFIX = sizeof("ZENIT_VERSION=") - 1;
const char *built_version() { return VERSION_MARKER + VERSION_PREFIX; }
} // namespace

#ifdef ZENIT_SIM
namespace
{
const char *version_override = nullptr;
char version_storage[48];
} // namespace

void sim_set_version(const char *version)
{
  std::strncpy(version_storage, version, sizeof(version_storage) - 1);
  version_override = version_storage;
}

const char *firmware_version() { return version_override ? version_override : built_version(); }
#else
const char *firmware_version() { return built_version(); }
#endif
const char *board_name() { return ZENIT_BOARD; }

} // namespace platform
