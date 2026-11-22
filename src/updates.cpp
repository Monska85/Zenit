// SPDX-License-Identifier: GPL-3.0-or-later

#include "updates.h"

#include <schedule.h>

#include <cstdio>
#include <cstring>

#include "app.h"
#include "firmware.h"
#include "net_time.h"
#include "network.h"
#include "platform.h"
#include "settings.h"
#include "site.h"

namespace updates
{

namespace
{
using zenit::update::Candidate;
using zenit::update::Result;
using zenit::update::State;

constexpr uint32_t TICK_EVERY_MS = 250;
constexpr uint32_t RETRY_STORE_MS = 2000;
// The reply to an install request goes out before the board restarts.
constexpr uint32_t RESTART_DELAY_MS = 1500;

// What the protocol reports: the check and the install in progress or last done.
struct Flow
{
  State state = State::Idle;
  Result last_result = Result::Never;
  zenit::update::Manifest offered;
  bool has_offer = false;
  Candidate offer_kind = Candidate::UpToDate;
  bool has_last_check = false;
  int64_t last_check = 0;
  int progress = -1;
};

// When to check and when to install by itself.
struct Schedule
{
  bool attempted = false;
  uint64_t last_attempt_ms = 0;
  bool last_failed = false;
  uint64_t ready_since_ms = 0;
  bool was_ready = false;
  uint64_t install_blocked_until_ms = 0;
  uint64_t next_tick_ms = 0;
};

// The boot: the trial, the record work that has to be stored, and the restart after an install.
struct Boot
{
  bool trial = false;
  bool protocol_started = false;
  // A boot whose record could not be read installs nothing.
  bool unsettled = false;
  // Record work that failed to be stored and is tried again.
  bool record_dirty = false;
  zenit::update::UpdateRecord wanted_record;
  uint64_t retry_at_ms = 0;
  bool restart_pending = false;
  uint64_t restart_at_ms = 0;
};

Flow flow;
Schedule schedule;
Boot boot;

// An X.Y.Z release is at most 20 characters (six digits each), which the record's version fields and the status hold.
static_assert(sizeof("999999.999999.999999") <= zenit::update::RECORD_VERSION_TEXT,
              "a release version must fit the record");

using Url = char[zenit::update::MAX_URL + 1];

// The manifest's address; false when it does not fit (the build refuses such a site address, so this does not happen).
bool manifest_url(Url &out)
{
  const int written = std::snprintf(out, sizeof(out), "%s%s", site::URL, site::MANIFEST_PATH);
  return written > 0 && static_cast<size_t>(written) < sizeof(out);
}

// Stores `next` as the update record; remembers it for another try when the write fails.
bool store(const zenit::update::UpdateRecord &next, uint64_t now)
{
  if (settings::commit_update(next) == settings::Commit::Ok)
  {
    boot.record_dirty = false;
    return true;
  }
  boot.record_dirty = true;
  boot.wanted_record = next;
  boot.retry_at_ms = now + RETRY_STORE_MS;
  return false;
}

void settle_boot(uint64_t now)
{
  zenit::update::UpdateRecord record = settings::update_record();
  const zenit::update::BootAction action =
      zenit::update::decide_settled_boot(record, platform::firmware_version(), firmware::other_slot_invalid());
  if (action == zenit::update::BootAction::Nothing)
    return;
  if (action == zenit::update::BootAction::Rollback)
    platform::log("version %s failed its trial: rolled back and skipped", record.pending);
  store(zenit::update::apply_boot_action(record, action), now);
}

bool connected_and_synced(const network::Snapshot &net)
{
  return net.state == zenit::net::WifiState::Connected && net.time_synced;
}

void start_check(uint64_t now)
{
  Url url;
  if (!manifest_url(url))
  {
    flow.last_result = Result::Unreachable;
    return;
  }
  if (!network::request_manifest(url))
    return;
  flow.state = State::Checking;
  schedule.attempted = true;
  schedule.last_attempt_ms = now;
}

void start_download()
{
  Url url;
  if (!manifest_url(url) || !network::request_download(url, flow.offered))
    return;
  flow.state = State::Downloading;
  flow.progress = 0;
}

// An install that failed: the running firmware and slot are as they were. Automatic installs wait before another try.
void fail_install(Result result, uint64_t now)
{
  firmware::abort_install();
  flow.last_result = result;
  flow.state = State::Idle;
  flow.progress = -1;
  schedule.install_blocked_until_ms = now + zenit::update::RETRY_AFTER_FAILURE_MS;
}

void finish_install(uint64_t now)
{
  zenit::update::UpdateRecord record = settings::update_record();
  // The pending version is stored first, and only then is the slot activated.
  if (!zenit::update::set_version(record.pending, flow.offered.version) ||
      settings::commit_update(record) != settings::Commit::Ok)
    return fail_install(Result::FlashError, now);
  if (!firmware::activate())
  {
    record.pending[0] = '\0';
    (void)settings::commit_update(record);
    return fail_install(Result::FlashError, now);
  }
  flow.last_result = Result::Installed;
  flow.state = State::Restarting;
  flow.progress = -1;
  boot.restart_pending = true;
  boot.restart_at_ms = now + RESTART_DELAY_MS;
}

// The pending image's evidence that it ran: stored before it confirms itself. False when it could not be stored yet.
bool store_booted(uint64_t now)
{
  if (!settings::update_record_readable())
    return true; // nothing can be stored: the unreadable record is settled after the trial
  const zenit::update::UpdateRecord record = settings::update_record();
  const zenit::update::UpdateRecord next = zenit::update::apply_booted(record, platform::firmware_version());
  if (next == record || store(next, now))
    return true;
  boot.retry_at_ms = now + RETRY_STORE_MS;
  return false;
}

void confirm_trial(uint64_t now)
{
  if (!boot.protocol_started || !app::first_output_written())
    return;
  if (!settings::memory_ok())
  {
    platform::log("health check failed: the settings memory did not open");
    firmware::mark_invalid_and_restart();
    return;
  }
  if (!store_booted(now))
    return;
  if (!firmware::mark_valid())
  {
    boot.retry_at_ms = now + RETRY_STORE_MS;
    return;
  }
  boot.trial = false;
  platform::log("firmware confirmed");
  if (settings::update_record_readable())
    store(zenit::update::apply_confirmed(settings::update_record(), platform::firmware_version()), now);
  else
    boot.unsettled = true;
}
} // namespace

void begin(uint64_t now)
{
  flow = Flow();
  schedule = Schedule();
  boot = Boot();
  boot.trial = firmware::on_trial();
  boot.unsettled = !settings::update_record_readable();
  if (!boot.trial && !boot.unsettled)
    settle_boot(now);
}

void protocol_ready() { boot.protocol_started = true; }

Status status()
{
  const zenit::net::BoardSettings &board = settings::board();
  Status s = {};
  s.mode = board.update_firmware ? zenit::net::update_mode_name(board.update_mode) : "off";
  s.state = flow.state;
  if (flow.has_offer)
    std::strcpy(s.available, flow.offered.version);
  s.has_last_check = flow.has_last_check;
  s.last_check = flow.last_check;
  s.last_result = flow.last_result;
  s.progress = flow.state == State::Downloading ? flow.progress : -1;
  s.trial = boot.trial;
  std::strcpy(s.skipped, settings::update_record().skipped);
  std::strcpy(s.rolled_back, settings::update_record().rolled_back);
  return s;
}

Reply request_check(uint64_t now)
{
  if (!zenit::update::firmware_updates_on(settings::board()))
    return Reply::UpdatesOff;
  const network::Snapshot net = network::snapshot();
  if (net.state != zenit::net::WifiState::Connected)
    return Reply::NoNetwork;
  if (flow.state != State::Idle)
    return Reply::Ok; // already running
  if (!net.time_synced)
  {
    flow.last_result = Result::NoTime;
    return Reply::Ok;
  }
  start_check(now);
  return flow.state == State::Checking ? Reply::Ok : Reply::Busy;
}

Reply request_install(bool force)
{
  if (!zenit::update::firmware_updates_on(settings::board()))
    return Reply::UpdatesOff;
  if (network::snapshot().state != zenit::net::WifiState::Connected)
    return Reply::NoNetwork;
  if (flow.state != State::Idle)
    return Reply::Busy;
  if (boot.trial || boot.unsettled || boot.record_dirty || !flow.has_offer ||
      (flow.offer_kind == Candidate::Skipped && !force))
    return Reply::NothingToInstall;
  start_download();
  return flow.state == State::Downloading ? Reply::Ok : Reply::Busy;
}

void on_manifest(Result result, const zenit::update::Manifest &manifest, uint64_t now)
{
  flow.state = State::Idle;
  schedule.attempted = true;
  schedule.last_attempt_ms = now;
  const network::Snapshot net = network::snapshot();
  if (net.time_synced)
  {
    flow.has_last_check = true;
    flow.last_check = net.epoch;
  }
  if (result != Result::Never)
  {
    flow.last_result = result;
    schedule.last_failed = true;
    flow.has_offer = false;
    return;
  }
  schedule.last_failed = false;
  const Candidate kind =
      zenit::update::judge(platform::firmware_version(), manifest.version, settings::update_record().skipped);
  flow.offer_kind = kind;
  flow.has_offer = kind != Candidate::UpToDate;
  if (flow.has_offer)
    flow.offered = manifest;
  flow.last_result = kind == Candidate::UpToDate  ? Result::UpToDate
                     : kind == Candidate::Skipped ? Result::Skipped
                                                  : Result::Available;
}

void on_progress(uint8_t percent)
{
  if (flow.state == State::Downloading)
    flow.progress = percent;
}

void on_download(Result result, uint64_t now)
{
  if (flow.state != State::Downloading)
    return;
  if (result != Result::Installed)
    return fail_install(result, now);
  flow.state = State::Verifying;
  finish_install(now);
}

void tick(uint64_t now)
{
  if (boot.restart_pending && now >= boot.restart_at_ms)
  {
    boot.restart_pending = false;
    firmware::restart();
    return;
  }
  if (now < schedule.next_tick_ms)
    return;
  schedule.next_tick_ms = now + TICK_EVERY_MS;

  if (boot.trial)
  {
    if (now >= boot.retry_at_ms)
      confirm_trial(now);
    return;
  }
  if (boot.record_dirty && now >= boot.retry_at_ms)
    store(boot.wanted_record, now);
  if (boot.unsettled && settings::update_record_readable() && !boot.record_dirty)
  {
    boot.unsettled = false;
    settle_boot(now);
  }
  if (flow.state != State::Idle || boot.unsettled || boot.record_dirty)
    return;

  const zenit::net::BoardSettings &board = settings::board();
  const network::Snapshot net = network::snapshot();
  const bool ready = connected_and_synced(net) && zenit::update::firmware_updates_on(board);
  if (ready && !schedule.was_ready)
    schedule.ready_since_ms = now;
  schedule.was_ready = ready;
  if (!ready)
    return;

  if (zenit::update::check_due(now, schedule.ready_since_ms, schedule.attempted, schedule.last_attempt_ms,
                               schedule.last_failed, board.check_hours))
  {
    start_check(now);
    return;
  }
  if (flow.has_offer && flow.offer_kind == Candidate::Available && now >= schedule.install_blocked_until_ms)
  {
    const int minute = net_time::local_minute(net.epoch);
    if (zenit::update::automatic_install_allowed(board, net.time_synced, static_cast<uint16_t>(minute)))
      start_download();
  }
}

#ifdef ZENIT_SIM
void sim_restart(uint64_t now)
{
  settings::begin();
  begin(now);
}
#endif

} // namespace updates
