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

const char *firmware_version() { return version_override ? version_override : ZENIT_VERSION; }
#else
const char *firmware_version() { return ZENIT_VERSION; }
#endif
const char *board_name() { return ZENIT_BOARD; }

} // namespace platform
