// SPDX-License-Identifier: GPL-3.0-or-later

// Brightness curve and power limit (docs/board/light-v1.md#brightness-curve, #power-limit).

#pragma once

#include <cstdint>

#include "light_types.h"

namespace zenit
{

// The duty for a perceptual lightness `lightness` from 0 to 100 (CIE 1931 L*). Values outside the range are clamped.
uint16_t lightness_to_duty(double lightness);

// Lowers every duty by the same factor when their estimated power is over `limit_mw`. Returns the power scale, a
// whole percentage from 1 to 100: 100 when the limit does not bind.
uint8_t apply_power_limit(Duties &duties, uint32_t limit_mw);

} // namespace zenit
