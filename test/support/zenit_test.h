// SPDX-License-Identifier: GPL-3.0-or-later

// Shared by the native test suites (test/test_*). Found through `-I$PROJECT_DIR/test/support` in [env:native_test].

#pragma once

#include <ArduinoJson.h>
#include <light_text.h>
#include <zenit_light.h>

#include <cctype>
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

// Appends the bytes of `hex` (pairs of hexadecimal digits) to `out`. False on an odd length or a character that is not
// a hexadecimal digit, so a typo in a case fails it instead of aborting the suite.
inline bool from_hex(const std::string &hex, std::string &out)
{
  if (hex.size() % 2 != 0)
    return false;
  for (size_t i = 0; i < hex.size(); i += 2)
  {
    if (!std::isxdigit(static_cast<unsigned char>(hex[i])) || !std::isxdigit(static_cast<unsigned char>(hex[i + 1])))
      return false;
    out += static_cast<char>(std::stoi(hex.substr(i, 2), nullptr, 16));
  }
  return true;
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
    else if (pair.value().is<long>())
      value = std::to_string(pair.value().as<long>());
    else
    {
      // A fraction, a boolean or null is a typo in a hand-worked case, never read as some integer.
      error = std::string(pair.key().c_str()) + ": expected an integer, a text or a list";
      return false;
    }
    if (!zenit::set_light_setting(settings, pair.key().c_str(), value, error))
      return false;
  }
  return true;
}

} // namespace zenit_test
