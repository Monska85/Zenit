// SPDX-License-Identifier: GPL-3.0-or-later

// Colors, channels and the firmware constants of docs/board/light-v1.md.

#pragma once

#include <cstddef>
#include <cstdint>

namespace zenit
{

// The colors the board can light, one at a time, in the order clients show them.
enum class Color : uint8_t
{
  White,
  Red,
  Green,
  Blue
};
constexpr size_t COLOR_COUNT = 4;

// Output channels, in GPIO order: red 3, green 4, blue 5, white 6.
enum Channel : uint8_t
{
  RED = 0,
  GREEN = 1,
  BLUE = 2,
  WHITE = 3
};
constexpr size_t CHANNEL_COUNT = 4;

// PWM: firmware constants, not settings.
constexpr uint32_t PWM_FREQUENCY_HZ = 1000;
constexpr uint8_t PWM_BITS = 14;
constexpr uint16_t DUTY_MAX = (1u << PWM_BITS) - 1; // 16383

// LED power at full duty of each channel, in mW, by Channel (docs/reference/hardware.md#electrical-values).
constexpr uint32_t FULL_SCALE_MW[CHANNEL_COUNT] = {610, 870, 870, 870};

// The power limit of the whole LED, in mW, set by the thermal test (docs/reference/hardware.md).
constexpr uint32_t POWER_LIMIT_MW = 1000;

// The engine computes the outputs every TICK_MS.
constexpr uint32_t TICK_MS = 10;

// The duty of each channel, indexed by Channel.
struct Duties
{
  uint16_t value[CHANNEL_COUNT] = {0, 0, 0, 0};
  bool operator==(const Duties &other) const
  {
    for (size_t i = 0; i < CHANNEL_COUNT; i++)
      if (value[i] != other.value[i])
        return false;
    return true;
  }
  bool operator!=(const Duties &other) const { return !(*this == other); }
};

Channel channel_of(Color color);
const char *color_name(Color color);
// False when `name` is not a color.
bool color_from_name(const char *name, Color &color);

} // namespace zenit
