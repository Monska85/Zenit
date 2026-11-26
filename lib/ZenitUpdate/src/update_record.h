// SPDX-License-Identifier: GPL-3.0-or-later

// The update record (docs/board/wifi-and-updates-v1.md#rollback): the pending installation, the skip list and the last
// rollback, and the decisions the boot takes from it.

#pragma once

#include <cstddef>
#include <cstdint>

namespace zenit
{
namespace update
{

constexpr size_t RECORD_VERSION_TEXT = 24;
constexpr uint8_t UPDATE_RECORD_VERSION = 1;
// The version byte, three version texts and the flag `booted`.
constexpr size_t UPDATE_RECORD_SIZE = 1 + 3 * RECORD_VERSION_TEXT + 1;

struct UpdateRecord
{
  // The version being installed, from before the restart until the boot after it settles.
  char pending[RECORD_VERSION_TEXT] = {0};
  // Set by the pending image itself when it starts (before its health check): the evidence that the installation was
  // tried. A rollback is declared only with it, so a power cut between storing the pending version and switching the
  // boot slot never skips a version that never ran, whatever an earlier rollback left in the slots.
  bool booted = false;
  // The one version that rolled back: automatic installs skip it.
  char skipped[RECORD_VERSION_TEXT] = {0};
  // The version that failed its trial the last time (reported until the next rollback).
  char rolled_back[RECORD_VERSION_TEXT] = {0};
};

bool operator==(const UpdateRecord &a, const UpdateRecord &b);

void encode_update_record(const UpdateRecord &record, uint8_t (&out)[UPDATE_RECORD_SIZE]);
// A record of another size or version, or with a text that is not terminated, is the empty record. False then.
bool decode_update_record(const uint8_t *in, size_t size, UpdateRecord &out);

// Copies `version` (at most 23 characters) into a record field; false when it does not fit.
bool set_version(char (&field)[RECORD_VERSION_TEXT], const char *version);

enum class BootAction : uint8_t
{
  Nothing,
  DropPending, // forget the pending installation (power lost before the switch, or after the confirmation)
  Rollback,    // the pending version failed its trial: skip it and report it
  SkipPending  // the installed image confirmed itself but reports another version than the one installed: skip it
};

// What a boot that is not on trial does with the record. `other_slot_invalid` says the other slot is marked invalid:
// the bootloader may have rolled back to this firmware, or an earlier rollback left it so. Only a pending version that
// booted (`record.booted`) is a rollback.
BootAction decide_settled_boot(const UpdateRecord &record, const char *running_version, bool other_slot_invalid);
// The record after the action.
UpdateRecord apply_boot_action(const UpdateRecord &record, BootAction action);

// The record after the pending image started on trial: `booted` is set whenever a version is pending. A trial boot
// happens only after the installed image was activated, so the image on trial is the installed one, whatever version
// it reports.
UpdateRecord apply_booted(const UpdateRecord &record);
// What a confirmed trial does with the pending version: nothing when none is pending, DropPending when it is the
// running version, SkipPending when the image reports another version (a release whose image and manifest disagree,
// which would otherwise be offered and installed again and again).
BootAction decide_confirmed_trial(const UpdateRecord &record, const char *running_version);
// The record after a confirmed trial: the action above, then the skip ends when it was the running version.
UpdateRecord apply_confirmed(const UpdateRecord &record, const char *running_version);

} // namespace update
} // namespace zenit
