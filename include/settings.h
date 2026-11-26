// SPDX-License-Identifier: GPL-3.0-or-later

// The settings (docs/protocol/protocol-v1.md#settings_get-settings_set). On the board they live in NVS; the simulator
// keeps them in memory for the length of a run. The light settings, the board settings and the update record are three
// records, each written in one step so a save is all or nothing even across a power cut.

#pragma once

#include <board_settings.h>
#include <light_settings.h>
#include <update_record.h>

#include <cstddef>
#include <cstdint>
#include <vector>

namespace settings
{

// Loads the stored settings. A missing or invalid value takes its default. A record the memory fails to read is never
// written over: after a failed read of the settings the board runs on the defaults (and a token made in RAM) and every
// commit of the settings fails until a restart reads them; after a failed read of the update record that record is
// not written either.
void begin();

const zenit::LightSettings &current();
const zenit::net::BoardSettings &board();
const zenit::update::UpdateRecord &update_record();
// Whether the settings memory opened (part of the trial's health check).
bool memory_ok();
// Whether the update record was read without an error (a missing record is readable and empty).
bool update_record_readable();
// Whether every record was read without an I/O error at begin() (a missing or damaged record counts as read). Part of
// the trial's health check.
bool read_ok();

enum class Commit
{
  Ok,
  Failed // nothing changed
};

// Stores `next` in one write, unless it equals the current settings. `next` must be valid.
Commit commit(const zenit::LightSettings &next);

// Stores new board settings. `next` must be valid. The token is made when it is empty.
Commit commit_board(const zenit::net::BoardSettings &next);
// Stores both: the board record first, the light record second; the board record is written back when the second
// write fails.
Commit commit_both(const zenit::LightSettings &light, const zenit::net::BoardSettings &board);
// Stores the update record.
Commit commit_update(const zenit::update::UpdateRecord &next);
// New board settings with defaults, a new token and no network.
zenit::net::BoardSettings fresh_board_settings();

#ifdef ZENIT_SIM
// Simulator: starts the next begin() from these stored values instead of the defaults.
void sim_store(const zenit::LightSettings &stored);
// Simulator: forgets what is stored, so the next begin() uses the defaults.
void sim_clear();
// Simulator: makes every write fail, or saving work again.
void sim_fail_writes(bool fail);
// Simulator: makes the writes of one record fail ("settings", "update"); an empty name ends it.
void sim_fail_key(const char *key);
// Simulator: stores these bytes as the record `key`, for tests of damaged records.
void sim_write_raw(const char *key, const std::vector<uint8_t> &bytes);
// Simulator: the bytes stored as the record `key`, empty when there is none.
std::vector<uint8_t> sim_read_raw(const char *key);
// Simulator: makes every read fail with an I/O error, or reading work again.
void sim_fail_reads(bool fail);
// Simulator: makes the reads of one record fail ("settings", "update"); an empty name ends it.
void sim_fail_read_key(const char *key);
// Simulator: puts the current settings back to the defaults without touching the memory.
void sim_reset_current();
// Simulator: the number of writes that reached the memory (failed ones excluded).
size_t sim_write_count();
#endif

} // namespace settings
