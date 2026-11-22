// SPDX-License-Identifier: GPL-3.0-or-later

// The network task and what the loop task sees of it (docs/board/wifi-and-updates-v1.md#tasks-and-memory): WiFi, time,
// scans and the update transfers, behind static queues and a snapshot. The board runs it on its own task
// (src/network_board.cpp); the simulator plays it on the loop (src/network_sim.cpp).

#pragma once

#include <board_settings.h>
#include <manifest.h>
#include <scan_list.h>
#include <update_status.h>
#include <wifi_logic.h>

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace network
{

enum class Provision : uint8_t
{
  None,
  Trying,
  Succeeded,
  Failed
};

// What the loop task reads: a copy made under a lock.
struct Snapshot
{
  zenit::net::WifiState state = zenit::net::WifiState::NotConfigured;
  char ssid[zenit::net::MAX_SSID + 1] = {0};
  bool rssi_known = false;
  int rssi = 0;
  bool has_ip = false;
  char ip[16] = {0};
  char hostname[11] = "zenit-0000";
  bool time_synced = false;
  int64_t epoch = 0;
  // The state of the last Improv try and the id its request got: a result counts for the request that has this id.
  Provision provision = Provision::None;
  uint32_t provision_id = 0;
};

using Network = zenit::net::ScanEntry;
constexpr size_t MAX_SCAN = zenit::net::MAX_SCAN_RESULTS;
// The longest a scan of the WiFi networks may take before it is stopped.
constexpr uint32_t SCAN_TIMEOUT_MS = 15000;

enum class ScanState : uint8_t
{
  Idle,
  Running,
  Done
};

// Starts the network task with the stored settings (board), or sets the simulated network up. Call once, after the
// settings are read.
void begin(const zenit::net::BoardSettings &settings);
// The board settings changed: WiFi credentials, power, time zone, NTP server, sync interval.
void apply(const zenit::net::BoardSettings &settings);
// Handles what the network task reported. Call on every pass of the loop.
void poll(uint64_t now);

Snapshot snapshot();

// Tries a network without storing it (Improv). Returns the id of the request, or 0 when one is running or the queue is
// full. The snapshot's `provision` and `provision_id` follow the try; a result with another id belongs to an earlier
// request.
uint32_t provision(const char *ssid, const char *password);

bool request_scan();
ScanState scan_state();
// Copies the networks of the last scan, strongest first, and returns how many; the scan state goes back to idle.
size_t take_scan(Network *out, size_t capacity);

// Closes the WebSocket client's connection (board only; the simulator's bridge does it on the line `!close-client`).
void close_client();

// Asks the network task to read the manifest at `url`, or to download the firmware the manifest describes. False when
// the queue is full.
bool request_manifest(const char *url);
bool request_download(const char *manifest_url, const zenit::update::Manifest &manifest);
// Whether a transfer is running (a TLS connection is open): nothing else asks for one meanwhile.
bool transfer_running();

// Whether the network task holds the large allocation (the HTTP server refuses new connections meanwhile).
bool holds_large_allocation();

#ifdef ZENIT_SIM
// Simulator: sets what the network reports.
void sim_set_snapshot(const Snapshot &snapshot);
// Simulator: the virtual time of the epoch (Unix seconds at virtual time zero), for `status.time`.
void sim_set_epoch_base(int64_t epoch);
// Simulator: the networks a scan finds.
void sim_set_scan(const Network *networks, size_t count);
// Simulator: the access points a scan finds, with names as the raw bytes the scan reported (any length, any bytes).
struct SimAccessPoint
{
  std::string ssid;
  int rssi;
  bool secure;
};
void sim_set_scan(const std::vector<SimAccessPoint> &access_points);
// Simulator: the list a scan gives now (every injected access point ranked), without taking it.
size_t sim_scan_list(Network *out, size_t capacity);
// Simulator: whether the credentials Improv sends connect.
void sim_set_provision_succeeds(bool succeeds);
// Simulator: the last settings applied, and how many times, for tests.
const zenit::net::BoardSettings &sim_applied();
// Simulator: whether close_client() was called since the last call here.
bool sim_take_close_client();
#endif

} // namespace network
