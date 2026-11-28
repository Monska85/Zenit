// SPDX-License-Identifier: GPL-3.0-or-later

#include "effects.h"

#include <cmath>

namespace zenit
{

namespace
{
// The notes of the Jingle Bells chorus, in beats (docs/board/light-v1.md#jingle); 4 beats of rest end the cycle.
constexpr uint8_t NOTE_BEATS[] = {1, 1, 2, 1, 1, 2, 1, 1, 1, 1, 4};
constexpr size_t NOTE_COUNT = sizeof(NOTE_BEATS);
} // namespace

EffectOutput JingleEffect::at(EffectState &, const LightSettings &settings, uint64_t t_ms, const TimerView &)
{
  const uint64_t cycle = t_ms / CYCLE_MS;
  const uint32_t u = static_cast<uint32_t>(t_ms % CYCLE_MS);
  // The last note that starts at or before u: its start and its length
  size_t note = 0;
  uint32_t start = 0;
  while (note + 1 < NOTE_COUNT && start + NOTE_BEATS[note] * BEAT_MS <= u)
    start += NOTE_BEATS[note++] * BEAT_MS;
  const uint32_t length = NOTE_BEATS[note] * BEAT_MS;
  const uint32_t e = u - start;
  const ColorList palette = color_set_colors(settings.color_set);
  EffectOutput out;
  out.color = palette.color[(cycle * NOTE_COUNT + note) % palette.count];
  if (e < RISE_MS)
    out.factor = BASE + (1000.0 - BASE) * e / RISE_MS;
  else
    out.factor = BASE + (1000.0 - BASE) * std::exp(-static_cast<double>(e - RISE_MS) / (0.35 * length));
  return out;
}

} // namespace zenit
