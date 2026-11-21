// SPDX-License-Identifier: GPL-3.0-or-later

// The application on the loop task: the light engine, its settings and the outputs.

#pragma once

#include <engine.h>

#include "settings.h"

namespace app
{

// Reads the settings and starts the light. Call once, after output::begin() and settings::begin().
void begin(uint64_t now, uint32_t seed);

// Computes the outputs at `now` and writes them. Returns the frame written.
const zenit::LightFrame &tick(uint64_t now);

// Whether an output has been written since the start (the trial boot of a new firmware waits for it).
bool first_output_written();

// Saves new light settings, then applies them with their transitions. `next` must be valid. Nothing changes unless
// the result is Ok.
settings::Commit change_settings(const zenit::LightSettings &next, uint64_t now);

// Turns the light on or off, without saving.
void set_light(bool on, uint64_t now);

// The frame written last.
const zenit::LightFrame &last_frame();

} // namespace app
