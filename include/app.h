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

// The work of the loop task besides the light: the network events, the update flow, Improv and the board LED.
void service(uint64_t now);

// Whether an output has been written since the start (the trial boot of a new firmware waits for it).
bool first_output_written();

// Saves new light and board settings together, then applies them: the light with its transitions, the network task with
// the new configuration. Nothing changes unless the result is Ok.
settings::Commit change_settings(const zenit::LightSettings &light, const zenit::net::BoardSettings &board,
                                 uint64_t now);

// Turns the light on or off, without saving.
void set_light(bool on, uint64_t now);

// Turns the light on as `light` with `on: true` does: from off, with the start favorite when one is marked (its look is
// saved first; on failure nothing changes and the light stays off), then as set_light(true).
settings::Commit turn_on(uint64_t now);

// Applies a favorite's look (saved first; on failure nothing changes) and turns the light on.
settings::Commit apply_favorite(const zenit::Favorite &favorite, uint64_t now);

// The frame written last.
const zenit::LightFrame &last_frame();

} // namespace app
