// SPDX-License-Identifier: GPL-3.0-or-later

// The LED outputs (docs/board/light-v1.md#channels): LEDC PWM on the board, a recorder in the simulator.

#pragma once

#include <light_types.h>

namespace output
{

// Drives every channel low, then attaches the PWM with every duty at 0. The board LED is off. Call once, first.
void begin();

// Writes the duty of every channel.
void write(const zenit::Duties &duties);

// The board's own blue LED (GPIO 8).
void status_led(bool on);

#ifdef ZENIT_SIM
// Simulator: the duties written last, and whether the board LED is on.
const zenit::Duties &sim_duties();
bool sim_status_led();
#endif

} // namespace output
