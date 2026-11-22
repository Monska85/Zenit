// SPDX-License-Identifier: GPL-3.0-or-later

// The firmware update flow on the loop task (docs/board/wifi-and-updates-v1.md#updates): the schedule, the state the
// protocol reports, the trial boot and the rollback. The transfers run on the network task.

#pragma once

#include <manifest.h>
#include <update_record.h>
#include <update_status.h>

#include <cstdint>

namespace updates
{

struct Status
{
  const char *mode; // the setting, or "off" when update_firmware is false
  zenit::update::State state;
  char available[zenit::update::RECORD_VERSION_TEXT]; // empty when none
  bool has_last_check;
  int64_t last_check;
  zenit::update::Result last_result;
  int progress; // -1 when not downloading
  bool trial;
  char skipped[zenit::update::RECORD_VERSION_TEXT];
  char rolled_back[zenit::update::RECORD_VERSION_TEXT];
};

enum class Reply : uint8_t
{
  Ok,
  UpdatesOff,
  NoNetwork,
  NothingToInstall,
  Busy
};

// Reads the update record and settles the boot: a rollback, a lost confirmation. Call once, after settings::begin().
void begin(uint64_t now);
// The protocol has started: part of the trial's health check.
void protocol_ready();
// Runs the schedule, the automatic install, the trial confirmation and the restart after an install.
void tick(uint64_t now);

Status status();
Reply request_check(uint64_t now);
Reply request_install(bool force);

// What the network task reported (called by network::poll).
void on_manifest(zenit::update::Result result, const zenit::update::Manifest &manifest, uint64_t now);
void on_progress(uint8_t percent);
void on_download(zenit::update::Result result, uint64_t now);

#ifdef ZENIT_SIM
// Simulator: forgets everything of the flow and reads the record again, as a restart does.
void sim_restart(uint64_t now);
#endif

} // namespace updates
