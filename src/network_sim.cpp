// SPDX-License-Identifier: GPL-3.0-or-later

// The network as the simulator plays it: a state the tests and control lines set, a scripted scan, and the update
// transfers run inline through the same worker as the board's network task.

#ifdef ZENIT_SIM

#include "network.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <string>

#include "mailbox.h"
#include "net_time.h"
#include "network_events.h"
#include "platform.h"
#include "update_worker.h"
#include "updates.h"

namespace network
{

namespace
{
Snapshot state;
int64_t epoch_base = 0;
zenit::net::BoardSettings applied;
Network scan_results[MAX_SCAN];
size_t scan_count = 0;
ScanState scan = ScanState::Idle;
bool scan_requested = false;
bool provision_ok = true;
uint32_t last_provision_id = 0;
// A request queued for the network task, which takes it at its next pass unless it is held (busy).
uint32_t requested_provision_id = 0;
uint32_t requested_queued_at = 0;
std::string requested_ssid;
// The try that runs: when it was queued (its deadline counts from there) and when the network task started it.
uint32_t provision_queued_at = 0;
uint64_t provision_started = 0;
bool held = false;
size_t apply_count = 0;
// The network the radio works on: the stored one, or the one being tried.
std::string radio_network;
uint16_t close_code = 0;
bool transfer = false;
Mailbox<UpdateEvent, 8> events;
char pending_url[zenit::update::MAX_URL + 1];
bool check_pending = false, download_pending = false;
zenit::update::Manifest pending_manifest;
install_target::Target pending_target = install_target::Target::Firmware;

// One thread plays both tasks, so progress goes straight to the update flow.
void post_progress(uint8_t percent) { updates::on_progress(percent); }

// The stored network when the download was asked for: a change before it ran (a forgotten or new network) stops it, as
// the board's network task stops a running one.
std::string download_ssid, download_password;
bool stored_network_changed()
{
  return download_ssid != applied.wifi_ssid || download_password != applied.wifi_password;
}
} // namespace

void begin(const zenit::net::BoardSettings &settings)
{
  state = Snapshot();
  applied = zenit::net::BoardSettings();
  scan = ScanState::Idle;
  scan_requested = false;
  transfer = false;
  check_pending = download_pending = false;
  events.clear();
  held = false;
  requested_provision_id = 0;
  radio_network.clear();
  apply(settings);
}

void apply(const zenit::net::BoardSettings &settings)
{
  // The simulated state follows the stored network only when the network changes: a new time zone or power leaves
  // what a test or a control line set.
  const bool network_changed = std::strcmp(applied.wifi_ssid, settings.wifi_ssid) != 0 ||
                               std::strcmp(applied.wifi_password, settings.wifi_password) != 0;
  applied = settings;
  apply_count++;
  // As the board's network task: the radio takes the stored network, unless an Improv try runs (it goes back to the
  // stored network when the try ends)
  if (state.provision != Provision::Trying)
    radio_network = settings.wifi_ssid;
  net_time::set_zone(settings.timezone);
  if (!network_changed)
  {
    if (settings.wifi_ssid[0] && state.state == zenit::net::WifiState::NotConfigured)
      state.state = zenit::net::WifiState::Connecting;
    return;
  }
  std::snprintf(state.ssid, sizeof(state.ssid), "%s", settings.wifi_ssid);
  state.has_ip = false;
  state.rssi_known = false;
  state.state = settings.wifi_ssid[0] ? zenit::net::WifiState::Connecting : zenit::net::WifiState::NotConfigured;
}

Snapshot snapshot()
{
  Snapshot copy = state;
  if (copy.time_synced)
    copy.epoch = epoch_base + static_cast<int64_t>(platform::now_ms() / 1000);
  return copy;
}

uint32_t provision(const char *ssid, const char *)
{
  if (state.provision == Provision::Trying || requested_provision_id != 0)
    return 0;
  // As on the board, the request only queues: the snapshot keeps the result of the earlier try until the network task
  // runs at its next pass (poll).
  requested_provision_id = ++last_provision_id;
  requested_queued_at = static_cast<uint32_t>(platform::now_ms());
  requested_ssid = ssid;
  return requested_provision_id;
}

bool request_scan()
{
  if (scan == ScanState::Running)
    return false;
  scan = ScanState::Running;
  scan_requested = true;
  return true;
}

ScanState scan_state() { return scan; }

size_t take_scan(Network *out, size_t capacity)
{
  // As the board: nothing until the scan is done
  if (scan != ScanState::Done)
    return 0;
  const size_t count = std::min(scan_count, capacity);
  std::memcpy(out, scan_results, count * sizeof(Network));
  scan = ScanState::Idle;
  return count;
}

void close_client(uint16_t code) { close_code = code; }

bool request_manifest(install_target::Target target, const char *url)
{
  if (transfer)
    return false;
  pending_target = target;
  std::strncpy(pending_url, url, sizeof(pending_url) - 1);
  pending_url[sizeof(pending_url) - 1] = '\0';
  transfer = check_pending = true;
  return true;
}

bool request_download(install_target::Target target, const char *manifest_url, const zenit::update::Manifest &manifest)
{
  if (transfer)
    return false;
  pending_target = target;
  std::strncpy(pending_url, manifest_url, sizeof(pending_url) - 1);
  pending_url[sizeof(pending_url) - 1] = '\0';
  pending_manifest = manifest;
  download_ssid = applied.wifi_ssid;
  download_password = applied.wifi_password;
  transfer = download_pending = true;
  return true;
}

bool holds_large_allocation() { return transfer; }

void poll(uint64_t now)
{
  if (scan_requested)
  {
    scan_requested = false;
    scan = ScanState::Done;
  }
  // The Improv try, on the board's rules: its 30 s count from the queueing, a request taken after them fails without
  // touching the radio, and a try that would end after them fails. A held network task (busy with a long transfer)
  // neither takes the request nor ends the try.
  const uint32_t now32 = static_cast<uint32_t>(now);
  if (!held && requested_provision_id != 0)
  {
    state.provision_id = requested_provision_id;
    requested_provision_id = 0;
    if (zenit::net::provision_expired(requested_queued_at, now32))
      state.provision = Provision::Failed;
    else
    {
      state.provision = Provision::Trying;
      provision_queued_at = requested_queued_at;
      provision_started = now;
      radio_network = requested_ssid;
    }
  }
  else if (!held && state.provision == Provision::Trying)
  {
    const bool expired = zenit::net::provision_expired(provision_queued_at, now32);
    if (expired || now - provision_started >= 1000)
    {
      state.provision = provision_ok && !expired ? Provision::Succeeded : Provision::Failed;
      if (state.provision == Provision::Failed)
        radio_network = applied.wifi_ssid;
    }
  }
  // The transfers run here, as the network task would, then their events are handled like the board's. A check that
  // asks for the web manifest after the firmware one finishes in the same pass, as a quick network would.
  for (int pass = 0; pass < 4; pass++)
  {
    if (check_pending)
    {
      check_pending = false;
      const update_worker::CheckResult found = update_worker::check(pending_target, pending_url);
      UpdateEvent event;
      event.type = UpdateEvent::Type::Manifest;
      event.target = pending_target;
      event.result = found.result;
      event.manifest = found.manifest;
      events.send(event);
    }
    if (download_pending)
    {
      download_pending = false;
      UpdateEvent event;
      event.type = UpdateEvent::Type::Downloaded;
      event.target = pending_target;
      event.result =
          update_worker::download(pending_target, pending_url, pending_manifest, post_progress, stored_network_changed);
      events.send(event);
    }
    UpdateEvent event;
    while (events.receive(event))
    {
      switch (event.type)
      {
      case UpdateEvent::Type::Manifest:
        transfer = false;
        updates::on_manifest(event.target, event.result, event.manifest, now);
        break;
      case UpdateEvent::Type::Downloaded:
        transfer = false;
        updates::on_download(event.target, event.result, now);
        break;
      }
    }
    if (!check_pending && !download_pending)
      break;
  }
}

void sim_set_snapshot(const Snapshot &snapshot) { state = snapshot; }
void sim_set_epoch_base(int64_t epoch) { epoch_base = epoch; }
void sim_set_scan(const std::vector<SimAccessPoint> &access_points)
{
  // As the board: every access point counts, one entry per name, the strongest 16 names, strongest first
  scan_count = 0;
  for (const SimAccessPoint &ap : access_points)
    zenit::net::scan_add(scan_results, scan_count, MAX_SCAN, ap.ssid.data(), ap.ssid.size(), ap.rssi, ap.secure);
  zenit::net::scan_sort(scan_results, scan_count);
}
void sim_set_scan(const Network *networks, size_t count)
{
  std::vector<SimAccessPoint> access_points;
  for (size_t i = 0; i < count; i++)
    access_points.push_back({networks[i].ssid, networks[i].rssi, networks[i].secure});
  sim_set_scan(access_points);
}
size_t sim_scan_list(Network *out, size_t capacity)
{
  const size_t count = std::min(scan_count, capacity);
  std::memcpy(out, scan_results, count * sizeof(Network));
  return count;
}
void sim_set_provision_succeeds(bool succeeds) { provision_ok = succeeds; }
void sim_hold(bool hold) { held = hold; }
uint32_t sim_requested_provision_id() { return requested_provision_id; }
size_t sim_apply_count() { return apply_count; }
const char *sim_radio_ssid() { return radio_network.c_str(); }
const zenit::net::BoardSettings &sim_applied() { return applied; }
uint16_t sim_take_close_client()
{
  const uint16_t code = close_code;
  close_code = 0;
  return code;
}

} // namespace network

#endif
