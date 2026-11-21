// SPDX-License-Identifier: GPL-3.0-or-later

#include "light_types.h"

#include <cstring>

namespace zenit
{

namespace
{
const char *const COLOR_NAMES[COLOR_COUNT] = {"white", "red", "green", "blue"};
} // namespace

Channel channel_of(Color color)
{
  switch (color)
  {
  case Color::Red:
    return RED;
  case Color::Green:
    return GREEN;
  case Color::Blue:
    return BLUE;
  case Color::White:
  default:
    return WHITE;
  }
}

const char *color_name(Color color)
{
  size_t index = static_cast<size_t>(color);
  return index < COLOR_COUNT ? COLOR_NAMES[index] : "white";
}

bool color_from_name(const char *name, Color &color)
{
  if (!name)
    return false;
  for (size_t i = 0; i < COLOR_COUNT; i++)
    if (std::strcmp(name, COLOR_NAMES[i]) == 0)
    {
      color = static_cast<Color>(i);
      return true;
    }
  return false;
}

} // namespace zenit
