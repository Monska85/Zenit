// SPDX-License-Identifier: GPL-3.0-or-later

#include "effects.h"

namespace zenit
{

EffectOutput StaticEffect::at(EffectState &, const LightSettings &settings, uint64_t, const TimerView &)
{
  return {settings.color, 1000.0};
}

} // namespace zenit
