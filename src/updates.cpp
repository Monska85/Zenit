// SPDX-License-Identifier: GPL-3.0-or-later

#include "updates.h"

#include <proto_limits.h>
#include <schedule.h>
#include <ws_message.h>

#include <atomic>

#include <cstdio>
#include <cstring>

#include "app.h"
#include "firmware.h"
#include "net_time.h"
#include "network.h"
#include "platform.h"
#include "settings.h"
#include "site.h"
#include "www.h"

namespace updates
{

namespace
{
using install_target::Target;
using zenit::update::Candidate;
using zenit::update::Result;
using zenit::update::State;
using zenit::update::WebState;

constexpr uint32_t TICK_EVERY_MS = 250;
constexpr uint32_t RETRY_STORE_MS = 2000;
// The reply to an install request goes out before the board restarts.
constexpr uint32_t RESTART_DELAY_MS = 1500;

// What the protocol reports: the check and the install in progress or last done. One transfer runs at a time; a check
// reads the firmware manifest when the firmware's updates can run (on, with a settled record), then the web manifest
// when web updates are on.
struct Flow
{
  State state = State::Idle;
  Target target = Target::Firmware; // of the transfer while not idle
  bool cycle_failed = false;        // a manifest of the check running failed
  Result last_result = Result::Never;
  zenit::update::Manifest offered;
  bool has_offer = false;
  Candidate offer_kind = Candidate::UpToDate;
  bool has_last_check = false;
  int64_t last_check = 0;
  int progress = -1;
};

// The web app's side: the last web check and install, and the repair of a missing or incompatible app.
struct WebFlow
{
  Result last_result = Result::Never;
  zenit::update::Manifest offered;
  bool has_offer = false;
  uint64_t install_blocked_until_ms = 0;
  uint32_t repair_failures = 0;
  uint64_t repair_at_ms = 0;
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
WebFlow web;
Schedule schedule;
Boot boot;
// Whether web updates are on, for the HTTP server's task (the emergency page).
std::atomic<bool> repairable{false};

// An X.Y.Z release is at most 20 characters (six digits each), which the record's version fields and the status hold.
static_assert(sizeof("999999.999999.999999") <= zenit::update::RECORD_VERSION_TEXT,
              "a release version must fit the record");

using Url = char[zenit::update::MAX_URL + 1];

// The address of the manifest of `target`; false when it does not fit (the build refuses such a site address, so this
// does not happen).
bool manifest_url(Target target, Url &out)
{
  const int written = std::snprintf(out, sizeof(out), "%s%s", site::URL,
                                    target == Target::Web ? site::WEB_MANIFEST_PATH : site::MANIFEST_PATH);
  return written > 0 && static_cast<size_t>(written) < sizeof(out);
}

bool web_on() { return zenit::update::web_updates_on(settings::board()); }
bool firmware_on() { return zenit::update::firmware_updates_on(settings::board()); }

// Whether the web app needs a repair: it is not usable, and the board may install it.
bool needs_repair()
{
  const WebState state = www::state();
  return (state == WebState::Missing || state == WebState::Incompatible) && web_on();
}

// A repair try failed: the next waits longer.
void repair_failed(uint64_t now)
{
  if (!needs_repair())
    return;
  web.repair_failures++;
  web.repair_at_ms = now + zenit::update::repair_wait_ms(web.repair_failures, platform::random32() % 1001);
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

// Asks for the manifest of `target`; false when the request could not be made.
bool request_manifest(Target target)
{
  Url url;
  if (!manifest_url(target, url))
  {
    (target == Target::Web ? web.last_result : flow.last_result) = Result::Unreachable;
    return false;
  }
  if (!network::request_manifest(target, url))
    return false;
  flow.state = State::Checking;
  flow.target = target;
  return true;
}

// The firmware's side waits while its update record is not settled; the web app's does not depend on that record.
bool firmware_ready() { return firmware_on() && !boot.unsettled && !boot.record_dirty; }

// `manual`: asked by update_check, which reads the firmware manifest whenever firmware updates are on.
void start_check(uint64_t now, bool manual = false)
{
  flow.cycle_failed = false;
  const bool firmware = manual ? firmware_on() : firmware_ready();
  const bool started = firmware ? request_manifest(Target::Firmware) : web_on() && request_manifest(Target::Web);
  if (!started)
    return;
  schedule.attempted = true;
  schedule.last_attempt_ms = now;
}

void start_download(Target target)
{
  Url url;
  const zenit::update::Manifest &offered = target == Target::Web ? web.offered : flow.offered;
  if (!manifest_url(target, url) || !network::request_download(target, url, offered))
    return;
  flow.state = State::Downloading;
  flow.target = target;
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
  const zenit::update::UpdateRecord next = zenit::update::apply_booted(record);
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
  if (!settings::read_ok())
  {
    // A firmware that cannot read its settings or its update record would run on defaults: the previous one boots
    platform::log("health check failed: the settings could not be read");
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
  {
    const zenit::update::UpdateRecord &record = settings::update_record();
    if (zenit::update::decide_confirmed_trial(record, platform::firmware_version()) ==
        zenit::update::BootAction::SkipPending)
      platform::log("version %s was installed but the firmware reports %s: %s is skipped", record.pending,
                    platform::firmware_version(), record.pending);
    store(zenit::update::apply_confirmed(record, platform::firmware_version()), now);
  }
  else
    boot.unsettled = true;
}
} // namespace

void begin(uint64_t now)
{
  flow = Flow();
  web = WebFlow();
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
  s.has_target = flow.state != State::Idle;
  s.target = flow.target;
  const www::Info image = www::info();
  s.web.state = image.state;
  std::snprintf(s.web.version, sizeof(s.web.version), "%s", image.version);
  if (web.has_offer)
    std::strcpy(s.web.available, web.offered.version);
  s.web.last_result = web.last_result;
  s.web.retry_in = -1;
  const uint64_t now = platform::now_ms();
  if (needs_repair() && web.repair_failures > 0 && web.repair_at_ms > now)
    s.web.retry_in = static_cast<int64_t>((web.repair_at_ms - now + 999) / 1000);
  return s;
}

bool web_repairable() { return repairable.load(); }

Reply request_check(uint64_t now)
{
  if (!firmware_on() && !web_on())
    return Reply::UpdatesOff;
  const network::Snapshot net = network::snapshot();
  if (net.state != zenit::net::WifiState::Connected)
    return Reply::NoNetwork;
  if (flow.state != State::Idle)
    return Reply::Ok; // already running
  if (!net.time_synced)
  {
    if (firmware_on())
      flow.last_result = Result::NoTime;
    if (web_on())
      web.last_result = Result::NoTime;
    return Reply::Ok;
  }
  start_check(now, true);
  return flow.state == State::Checking ? Reply::Ok : Reply::Busy;
}

Reply request_install(Target target, bool force)
{
  const bool web_target = target == Target::Web;
  if (!(web_target ? web_on() : firmware_on()))
    return Reply::UpdatesOff;
  if (network::snapshot().state != zenit::net::WifiState::Connected)
    return Reply::NoNetwork;
  if (flow.state != State::Idle)
    return Reply::Busy;
  if (boot.trial)
    return Reply::NothingToInstall;
  if (web_target)
  {
    if (!web.has_offer)
      return Reply::NothingToInstall;
  }
  else if (boot.unsettled || boot.record_dirty || !flow.has_offer || (flow.offer_kind == Candidate::Skipped && !force))
    return Reply::NothingToInstall;
  start_download(target);
  return flow.state == State::Downloading ? Reply::Ok : Reply::Busy;
}

namespace
{
// The end of a check: both manifests were read, or the second could not be asked for.
void end_check(uint64_t now)
{
  flow.state = State::Idle;
  schedule.attempted = true;
  schedule.last_attempt_ms = now;
  schedule.last_failed = flow.cycle_failed;
  const network::Snapshot net = network::snapshot();
  if (net.time_synced)
  {
    flow.has_last_check = true;
    flow.last_check = net.epoch;
  }
  // A repair that found nothing to install waits before the next try.
  if (needs_repair() && !web.has_offer)
    repair_failed(now);
}

void judge_firmware(Result result, const zenit::update::Manifest &manifest)
{
  if (result != Result::Never)
  {
    flow.last_result = result;
    flow.cycle_failed = true;
    flow.has_offer = false;
    return;
  }
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

// A web version is worth installing when it is newer than the image in the partition, or when the partition holds no
// image that reads; it is installed only when it speaks the firmware's protocol.
void judge_web(Result result, const zenit::update::Manifest &manifest)
{
  web.has_offer = false;
  if (result != Result::Never)
  {
    web.last_result = result;
    flow.cycle_failed = true;
    return;
  }
  // An incompatible image is replaced by any version that speaks the firmware's protocol, an older one too (after a
  // firmware rollback, for example).
  const www::Info image = www::info();
  const bool have = image.state == WebState::Ok && zenit::update::is_release(image.version);
  const bool newer = !have || zenit::update::judge(image.version, manifest.version, "") == Candidate::Available;
  if (!newer)
    web.last_result = Result::UpToDate;
  else if (!zenit::update::speaks(manifest.protocol_min, manifest.protocol_max, zenit::proto::PROTOCOL_VERSION))
    web.last_result = Result::Incompatible;
  else
  {
    web.last_result = Result::Available;
    web.has_offer = true;
    web.offered = manifest;
  }
}

// A failed web install. The offer stays for another try of the same download, except when the file was not what the
// manifest promised (a bad download): then a new check decides.
void fail_web_install(Result result, uint64_t now, bool drop_offer = false)
{
  web.last_result = result;
  if (drop_offer)
    web.has_offer = false;
  flow.state = State::Idle;
  flow.progress = -1;
  web.install_blocked_until_ms = now + zenit::update::RETRY_AFTER_FAILURE_MS;
  repair_failed(now);
}
} // namespace

void on_manifest(Target target, Result result, const zenit::update::Manifest &manifest, uint64_t now)
{
  if (flow.state != State::Checking)
    return;
  if (target == Target::Web)
  {
    judge_web(result, manifest);
    end_check(now);
    return;
  }
  judge_firmware(result, manifest);
  if (!web_on() || !request_manifest(Target::Web))
    end_check(now);
}

void on_progress(uint8_t percent)
{
  if (flow.state == State::Downloading)
    flow.progress = percent;
}

void on_download(Target target, Result result, uint64_t now)
{
  if (flow.state != State::Downloading || target != flow.target)
    return;
  if (target == Target::Firmware)
  {
    if (result != Result::Installed)
      return fail_install(result, now);
    flow.state = State::Verifying;
    finish_install(now);
    return;
  }
  if (result != Result::Installed)
    return fail_web_install(result, now, result == Result::BadDownload);
  // The image reads and speaks this firmware's protocol; it must also be the version offered.
  const www::Info image = www::info();
  if (image.state != WebState::Ok)
    return fail_web_install(image.state == WebState::Incompatible ? Result::Incompatible : Result::BadDownload, now,
                            true);
  if (std::strcmp(image.version, web.offered.version) != 0)
    return fail_web_install(Result::BadDownload, now, true);
  web.last_result = Result::Installed;
  web.has_offer = false;
  web.repair_failures = 0;
  web.repair_at_ms = 0;
  flow.state = State::Idle;
  flow.progress = -1;
  platform::log("web app %s installed", image.version);
  // An open page reloads to load the new app.
  network::close_client(zenit::proto::CLOSE_RELOAD);
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
  repairable = web_on();

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
  if (flow.state != State::Idle)
    return;

  const zenit::net::BoardSettings &board = settings::board();
  const network::Snapshot net = network::snapshot();
  const bool ready = connected_and_synced(net) && (firmware_ready() || web_on());
  if (ready && !schedule.was_ready)
  {
    schedule.ready_since_ms = now;
    // A new connection: the repair starts again from the shortest wait.
    web.repair_failures = 0;
    web.repair_at_ms = 0;
  }
  schedule.was_ready = ready;
  if (!ready)
    return;

  // While the web app needs a repair, the repair's waits alone pace the checks (below).
  if (!needs_repair() && zenit::update::check_due(now, schedule.ready_since_ms, schedule.attempted,
                                                  schedule.last_attempt_ms, schedule.last_failed, board.check_hours))
  {
    start_check(now);
    return;
  }
  const int minute = net_time::local_minute(net.epoch);
  if (firmware_ready() && flow.has_offer && flow.offer_kind == Candidate::Available &&
      now >= schedule.install_blocked_until_ms &&
      zenit::update::automatic_install_allowed(board, net.time_synced, static_cast<uint16_t>(minute)))
  {
    start_download(Target::Firmware);
    return;
  }
  // A missing or incompatible web app is installed at once, whatever the window and the mode, then after each failure
  // a longer wait.
  if (needs_repair())
  {
    if (now >= web.repair_at_ms)
    {
      if (web.has_offer)
        start_download(Target::Web);
      else
        start_check(now);
    }
    return;
  }
  if (web.has_offer && now >= web.install_blocked_until_ms &&
      zenit::update::automatic_web_install_allowed(board, net.time_synced, static_cast<uint16_t>(minute)))
    start_download(Target::Web);
}

#ifdef ZENIT_SIM
void sim_restart(uint64_t now)
{
  settings::begin();
  begin(now);
}
#endif

} // namespace updates
