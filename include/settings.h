// SPDX-License-Identifier: GPL-3.0-or-later

// The settings (docs/protocol/protocol-v1.md#settings_get-settings_set). On the board they live in NVS; the simulator
// keeps them in memory for the length of a run. This milestone holds the light settings, stored as one record so a
// save is all or nothing even across a power cut.

#pragma once

#include <light_settings.h>

#include <cstdint>
#include <vector>

namespace settings
{

// Loads the stored settings. A missing or invalid value takes its default.
void begin();

const zenit::LightSettings &current();

enum class Commit
{
  Ok,
  Failed // nothing changed
};

// Stores `next` in one write, unless it equals the current settings. `next` must be valid.
Commit commit(const zenit::LightSettings &next);

#ifdef ZENIT_SIM
// Simulator: starts the next begin() from these stored values instead of the defaults.
void sim_store(const zenit::LightSettings &stored);
// Simulator: forgets what is stored, so the next begin() uses the defaults.
void sim_clear();
// Simulator: makes every write fail, or saving work again.
void sim_fail_writes(bool fail);
// Simulator: stores these bytes as the record `key`, for tests of damaged records.
void sim_write_raw(const char *key, const std::vector<uint8_t> &bytes);
// Simulator: puts the current settings back to the defaults without touching the memory.
void sim_reset_current();
#endif

} // namespace settings
