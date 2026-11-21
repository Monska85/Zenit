// SPDX-License-Identifier: GPL-3.0-or-later

// Shared by the native test suites (test/test_*). Found through `-I$PROJECT_DIR/test/support` in [env:native_test].

#pragma once

#include <ArduinoJson.h>
#include <light_text.h>
#include <zenit_light.h>

#include <fstream>
#include <sstream>
#include <string>

namespace zenit_test
{

inline const std::string PROJECT_DIR = ZENIT_PROJECT_DIR;

inline std::string read_file(const std::string &path)
{
  std::ifstream in(path, std::ios::binary);
  std::stringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

// Applies the settings of a JSON object, as the protocol names them, to `settings`. False on an unknown or bad one.
inline bool apply_settings(zenit::LightSettings &settings, JsonObjectConst object, std::string &error)
{
  for (JsonPairConst pair : object)
  {
    std::string value;
    if (pair.value().is<JsonArrayConst>())
    {
      for (JsonVariantConst item : pair.value().as<JsonArrayConst>())
        value += (value.empty() ? "" : ",") + std::string(item.as<const char *>());
    }
    else if (pair.value().is<const char *>())
      value = pair.value().as<const char *>();
    else
      value = std::to_string(pair.value().as<long>());
    if (!zenit::set_light_setting(settings, pair.key().c_str(), value, error))
      return false;
  }
  return true;
}

} // namespace zenit_test
