// SPDX-License-Identifier: GPL-3.0-or-later

#include "light_text.h"

#include <cstdlib>

namespace zenit
{

namespace
{
bool parse_number(const std::string &text, uint32_t &out)
{
  if (text.empty() || text.size() > 6)
    return false;
  for (char c : text)
    if (c < '0' || c > '9')
      return false;
  out = static_cast<uint32_t>(std::strtoul(text.c_str(), nullptr, 10));
  return true;
}
} // namespace

bool set_light_setting(LightSettings &settings, const std::string &key, const std::string &value, std::string &error)
{
  const LightField *field = find_light_field(key.c_str());
  if (!field)
  {
    error = "unknown setting '" + key + "'";
    return false;
  }
  LightSettings next = settings;
  uint32_t number = 0;
  bool ok = true;
  if (field->kind == FieldKind::Number)
    ok = parse_number(value, number) && number >= field->min && number <= field->max && field->store(next, number, "");
  else if (field->kind == FieldKind::Name)
    ok = field->store(next, 0, value.c_str());
  else
  {
    ColorList list;
    list.count = 0;
    size_t start = 0;
    while (ok)
    {
      size_t comma = value.find(',', start);
      std::string name = value.substr(start, comma == std::string::npos ? std::string::npos : comma - start);
      ok = list.count < MAX_COLORS && color_from_name(name.c_str(), list.color[list.count]);
      if (ok)
        list.count++;
      if (comma == std::string::npos)
        break;
      start = comma + 1;
    }
    ok = ok && valid_colors(list);
    if (ok)
      next.colors = list;
  }
  if (!ok)
  {
    error = "invalid value '" + value + "' for " + key;
    return false;
  }
  settings = next;
  return true;
}

} // namespace zenit
