// SPDX-License-Identifier: GPL-3.0-or-later

#include "platform.h"

#ifndef ZENIT_VERSION
#define ZENIT_VERSION "0.0.0-unknown"
#endif
#ifndef ZENIT_BOARD
#define ZENIT_BOARD "unknown"
#endif

namespace platform
{

const char *firmware_version() { return ZENIT_VERSION; }
const char *board_name() { return ZENIT_BOARD; }

} // namespace platform
