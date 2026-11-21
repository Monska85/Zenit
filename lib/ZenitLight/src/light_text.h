// SPDX-License-Identifier: GPL-3.0-or-later

// Light settings as text, `key=value`, for the simulator's options and the tools. Lists are comma separated.

#pragma once

#include <string>

#include "light_settings.h"

namespace zenit
{

// Sets one setting from text. On failure returns false, leaves `settings` unchanged and sets `error`.
bool set_light_setting(LightSettings &settings, const std::string &key, const std::string &value, std::string &error);

} // namespace zenit
