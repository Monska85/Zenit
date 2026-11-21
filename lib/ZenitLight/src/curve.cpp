// SPDX-License-Identifier: GPL-3.0-or-later

#include "curve.h"

#include <cmath>

namespace zenit
{

uint16_t lightness_to_duty(double lightness)
{
  if (!(lightness > 0.0))
    return 0;
  if (lightness >= 100.0)
    return DUTY_MAX;
  double luminance;
  if (lightness > 8.0)
  {
    double base = (lightness + 16.0) / 116.0;
    luminance = base * base * base;
  }
  else
    luminance = lightness / 903.3;
  double duty = std::floor(DUTY_MAX * luminance + 0.5);
  return duty >= DUTY_MAX ? DUTY_MAX : static_cast<uint16_t>(duty);
}

uint8_t apply_power_limit(Duties &duties, uint32_t limit_mw)
{
  double power = 0.0;
  for (size_t i = 0; i < CHANNEL_COUNT; i++)
    power += static_cast<double>(duties.value[i]) * FULL_SCALE_MW[i] / DUTY_MAX;
  if (!(power > limit_mw))
    return 100;
  for (size_t i = 0; i < CHANNEL_COUNT; i++)
    duties.value[i] = static_cast<uint16_t>(std::floor(static_cast<double>(duties.value[i]) * limit_mw / power));
  double scale = std::floor(100.0 * limit_mw / power);
  return scale < 1.0 ? 1 : static_cast<uint8_t>(scale);
}

} // namespace zenit
