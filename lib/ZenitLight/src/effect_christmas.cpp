// SPDX-License-Identifier: GPL-3.0-or-later

#include "effects.h"

namespace zenit
{

EffectOutput ChristmasEffect::at(EffectState &, const LightSettings &settings, uint64_t t_ms, const TimerView &)
{
  return ColorChangeEffect::cycle(color_set_colors(settings.color_set), settings.hold_seconds, t_ms);
}

} // namespace zenit
