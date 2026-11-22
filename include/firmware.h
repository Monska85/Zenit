// SPDX-License-Identifier: GPL-3.0-or-later

// The firmware slots: the trial boot, the rollback and the installation of a new image
// (docs/board/wifi-and-updates-v1.md#rollback). Board: esp_ota_ops (src/firmware_board.cpp); simulator: a model with
// failure injection (src/firmware_sim.cpp).

#pragma once

#include <cstddef>
#include <cstdint>

namespace firmware
{

// Whether the running image has not confirmed itself yet.
bool on_trial();
// Whether the bootloader rolled back to this image (the slot it left is marked invalid).
bool other_slot_invalid();
// Confirms the running image. False when that failed.
bool mark_valid();
// Rolls back to the previous image and restarts. Returns only when it failed.
void mark_invalid_and_restart();

// Installing: a sequence on one task at a time. `begin_install` selects the inactive slot for an image of `size`
// bytes; `write` appends; `end_install` checks the image; `abort_install` gives up. All return false on failure, and
// the running slot is untouched whatever happens.
bool begin_install(uint32_t size);
bool write(const uint8_t *data, size_t size);
bool end_install();
void abort_install();
// Makes the installed image the one that boots next. False when that failed.
bool activate();
// Restarts the board.
void restart();

#ifdef ZENIT_SIM
// Simulator: the model's controls.
void sim_reset();
void sim_set_trial(bool trial);
void sim_set_other_invalid(bool invalid);
void sim_fail(const char *step); // "begin", "write", "end", "activate" or "mark_valid"; "" clears
bool sim_activated();
bool sim_restarted();
bool sim_marked_invalid();
bool sim_marked_valid();
uint32_t sim_written();
#endif

} // namespace firmware
