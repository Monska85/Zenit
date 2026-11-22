// SPDX-License-Identifier: GPL-3.0-or-later

// The network task of the board: WiFi, mDNS, SNTP, the HTTP and WebSocket server, and the update transfers. It moves
// bytes only: it never reads or writes the light or the settings (docs/board/wifi-and-updates-v1.md#tasks-and-memory).

#ifndef ZENIT_SIM

#include "network.h"

#include <Arduino.h>
#include <ESPmDNS.h>
#include <WiFi.h>
#include <esp_mac.h>
#include <esp_sntp.h>
#include <esp_system.h>
#include <esp_wifi.h>

#include <atomic>
#include <cstring>

#include "mailbox.h"
#include "network_events.h"
#include "platform.h"
#include "task_sync.h"
#include "update_worker.h"
#include "updates.h"
#include "ws_server.h"

namespace network
{

namespace
{
using zenit::net::WifiState;

constexpr uint32_t TASK_STACK_BYTES = 12288;
constexpr uint32_t LOOP_MS = 100;
// A try to join a network gives up after this long without a result.
constexpr uint32_t ATTEMPT_MS = 20000;
// A connection started by Improv answers within this time.
constexpr uint32_t PROVISION_MS = 30000;

// ---- Shared by the two tasks. Each variable is guarded by `lock` or is an atomic, as the group says. ----
Lock lock;
// Guarded by `lock`: the snapshot the loop task reads (the network task writes it), the configuration the loop task
// writes, the networks of the last scan, and the counter of Improv requests.
Snapshot published;
zenit::net::BoardSettings config;
uint32_t config_generation = 0;
Network scan_results[MAX_SCAN];
size_t scan_count = 0;
uint32_t provision_counter = 0;
// Atomics, no lock needed: the scan state (both tasks), whether a transfer was asked for (the loop task sets it, the
// events clear it), and whether the network task holds a TLS connection (the HTTP server reads it).
std::atomic<ScanState> scan_state_value{ScanState::Idle};
std::atomic<bool> transfer{false};
std::atomic<bool> large{false};
// The latest download progress the loop task has not read yet, or -1.
std::atomic<int> progress_percent{-1};
// The loop task only: begin() ran.
bool started = false;

struct Command
{
  enum class Type : uint8_t
  {
    Provision,
    Scan,
    Manifest,
    Download
  };
  Type type = Type::Scan;
  install_target::Target target = install_target::Target::Firmware; // of a Manifest or a Download
  uint32_t id = 0;                                                  // of a Provision: the id its result carries
  char ssid[zenit::net::MAX_SSID + 1] = {0};
  char password[zenit::net::MAX_PASSWORD + 1] = {0};
  char url[zenit::update::MAX_URL + 1] = {0}; // a manifest or firmware address: the build refuses a longer one
  zenit::update::Manifest manifest;
};

Mailbox<Command, 3> commands;
// Only the end of a transfer, one at a time: the queue never fills.
Mailbox<UpdateEvent, 2> events;

// ---- The network task only ----
std::atomic<bool> got_ip{false};
std::atomic<bool> associated{false};
std::atomic<int> disconnect_reason{-1};
std::atomic<bool> time_synced{false};
char hostname[11] = "zenit-0000";
char sntp_server[zenit::net::MAX_NTP_SERVER + 1] = "";

struct Radio
{
  zenit::net::BoardSettings board;
  uint32_t generation = 0;
  bool power_applied = false;
  int applied_quarter_dbm = 0;
  // The connection manager.
  WifiState state = WifiState::NotConfigured;
  bool trying = false;
  uint32_t attempt_started = 0;
  uint32_t associated_since = 0;
  uint32_t next_try = 0;
  uint32_t failures = 0;
  bool fell_back = false;
  bool services_up = false;
  // Each service that runs while the board is connected is started again after a failed start, after a growing wait.
  bool mdns_up = false;
  zenit::net::RetryTimer mdns_retry, sntp_retry, server_retry;
  // A connection tried for Improv.
  bool provisioning = false;
  char try_ssid[zenit::net::MAX_SSID + 1] = {0};
  char try_password[zenit::net::MAX_PASSWORD + 1] = {0};
  uint32_t provision_started = 0;
  uint32_t provision_id = 0;
  // The credentials the radio is working on now.
  char active_ssid[zenit::net::MAX_SSID + 1] = {0};
  char active_password[zenit::net::MAX_PASSWORD + 1] = {0};
} radio;

void on_wifi_event(arduino_event_id_t event, arduino_event_info_t info)
{
  switch (event)
  {
  case ARDUINO_EVENT_WIFI_STA_CONNECTED:
    associated = true;
    break;
  case ARDUINO_EVENT_WIFI_STA_GOT_IP:
    got_ip = true;
    break;
  case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
    got_ip = false;
    associated = false;
    disconnect_reason = info.wifi_sta_disconnected.reason;
    break;
  default:
    break;
  }
}

void on_time_sync(struct timeval *) { time_synced = true; }

void start_sntp(const zenit::net::BoardSettings &board)
{
  if (esp_sntp_enabled())
    esp_sntp_stop();
  std::snprintf(sntp_server, sizeof(sntp_server), "%s", board.ntp_server);
  esp_sntp_setoperatingmode(ESP_SNTP_OPMODE_POLL);
  esp_sntp_setservername(0, sntp_server);
  esp_sntp_set_sync_interval(static_cast<uint32_t>(board.time_sync_hours) * 3600u * 1000u);
  esp_sntp_set_time_sync_notification_cb(on_time_sync);
  esp_sntp_init();
}

// The HTTP server runs while the board is connected: a start that failed is tried again after a growing wait.
void ensure_server(uint32_t now)
{
  if (ws_server::running() || !radio.server_retry.due(now))
    return;
  if (ws_server::start())
    radio.server_retry.reset();
  else
    radio.server_retry.failed(now);
}

void ensure_mdns(uint32_t now)
{
  if (radio.mdns_up || !radio.mdns_retry.due(now))
    return;
  // The name and the `_http._tcp` service both have to work; a name without its service is ended and tried again
  if (MDNS.begin(hostname) && MDNS.addService("http", "tcp", 80))
  {
    radio.mdns_up = true;
    radio.mdns_retry.reset();
    return;
  }
  MDNS.end();
  radio.mdns_retry.failed(now);
}

void ensure_sntp(uint32_t now)
{
  if (esp_sntp_enabled() || !radio.sntp_retry.due(now))
    return;
  start_sntp(radio.board);
  if (esp_sntp_enabled())
    radio.sntp_retry.reset();
  else
    radio.sntp_retry.failed(now);
}

void start_services(uint32_t now)
{
  radio.services_up = true;
  ensure_mdns(now);
  ensure_sntp(now);
  ensure_server(now);
}

void stop_services()
{
  if (!radio.services_up)
    return;
  radio.services_up = false;
  radio.mdns_retry.reset();
  radio.sntp_retry.reset();
  radio.server_retry.reset();
  ws_server::stop();
  if (esp_sntp_enabled())
    esp_sntp_stop();
  if (radio.mdns_up)
    MDNS.end();
  radio.mdns_up = false;
}

void apply_power()
{
  const int quarter = zenit::net::effective_power_quarter_dbm(radio.board.wifi_power, radio.failures, radio.fell_back);
  if (radio.power_applied && quarter == radio.applied_quarter_dbm)
    return;
  WiFi.setTxPower(static_cast<wifi_power_t>(quarter));
  radio.applied_quarter_dbm = quarter;
  radio.power_applied = true;
}

void radio_on()
{
  if (WiFi.getMode() == WIFI_STA)
    return;
  WiFi.persistent(false);
  WiFi.setAutoReconnect(false);
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(hostname);
  radio.power_applied = false;
  apply_power();
}

void radio_off()
{
  stop_services();
  if (WiFi.getMode() != WIFI_OFF)
    WiFi.mode(WIFI_OFF);
  got_ip = false;
  associated = false;
  radio.trying = false;
}

void begin_attempt(uint32_t now)
{
  radio_on();
  apply_power();
  got_ip = false;
  associated = false;
  disconnect_reason = -1;
  WiFi.disconnect(false, false);
  WiFi.begin(radio.active_ssid, radio.active_password[0] ? radio.active_password : nullptr);
  radio.trying = true;
  radio.attempt_started = now;
  radio.associated_since = 0;
  radio.state = WifiState::Connecting;
}

void fail_attempt(uint32_t now, WifiState state)
{
  radio.trying = false;
  radio.state = state;
  radio.failures++;
  if (zenit::net::power_fallback_due(radio.board.wifi_power, radio.failures))
    radio.fell_back = true;
  radio.next_try = now + zenit::net::reconnect_wait_ms(radio.failures);
  WiFi.disconnect(false, false);
}

// One pass of the connection manager for the credentials in `active_*`.
void manage_connection(uint32_t now)
{
  if (radio.state == WifiState::Connected)
  {
    if (!got_ip.load())
    {
      // Lost: start again at once, with the short wait of a first failure.
      radio.state = WifiState::Connecting;
      radio.failures = 0;
      radio.trying = false;
      radio.next_try = now + zenit::net::reconnect_wait_ms(1);
      stop_services();
      return;
    }
    // Connected: the services keep running, and a server that failed to start is tried again
    start_services(now);
    return;
  }
  if (radio.trying)
  {
    if (got_ip.load())
    {
      radio.trying = false;
      radio.state = WifiState::Connected;
      radio.failures = 0;
      start_services(now);
      return;
    }
    const int reason = disconnect_reason.exchange(-1);
    if (reason >= 0)
    {
      const WifiState cause = zenit::net::state_for_disconnect(static_cast<uint8_t>(reason));
      fail_attempt(now, cause);
      return;
    }
    if (associated.load())
    {
      if (radio.associated_since == 0)
        radio.associated_since = now;
      else if (now - radio.associated_since >= zenit::net::ADDRESS_WAIT_MS)
        fail_attempt(now, WifiState::NoAddress);
    }
    else if (now - radio.attempt_started >= ATTEMPT_MS)
      fail_attempt(now, WifiState::Connecting);
    return;
  }
  if (static_cast<int32_t>(now - radio.next_try) >= 0)
    begin_attempt(now);
}

void use_credentials(const char *ssid, const char *password, uint32_t now)
{
  std::snprintf(radio.active_ssid, sizeof(radio.active_ssid), "%s", ssid);
  std::snprintf(radio.active_password, sizeof(radio.active_password), "%s", password);
  radio.failures = 0;
  radio.trying = false;
  radio.next_try = now;
  stop_services();
  if (radio.active_ssid[0])
  {
    radio.state = WifiState::Connecting;
    WiFi.disconnect(false, false);
  }
  else
  {
    radio.state = WifiState::NotConfigured;
    radio_off();
  }
}

void take_config(uint32_t now)
{
  zenit::net::BoardSettings next;
  uint32_t generation;
  {
    Locked held(lock);
    next = config;
    generation = config_generation;
  }
  if (generation == radio.generation)
    return;
  radio.generation = generation;
  const zenit::net::BoardSettings old = radio.board;
  radio.board = next;
  radio.power_applied = false;
  if (radio.services_up &&
      (std::strcmp(old.ntp_server, next.ntp_server) != 0 || old.time_sync_hours != next.time_sync_hours))
    start_sntp(next);
  if (radio.provisioning)
    return; // the stored network is taken up again when the Improv try ends
  const bool same = std::strcmp(radio.active_ssid, next.wifi_ssid) == 0 &&
                    std::strcmp(radio.active_password, next.wifi_password) == 0;
  if (!same)
    use_credentials(next.wifi_ssid, next.wifi_password, now);
  else if (radio.state == WifiState::Connected || radio.trying)
    apply_power();
}

void publish()
{
  Snapshot snap;
  snap.state = radio.provisioning ? WifiState::Connecting : radio.state;
  // The stored network, as the loop task committed it: a network that is only being tried, or that was not saved, is
  // not shown
  std::snprintf(snap.ssid, sizeof(snap.ssid), "%s", radio.board.wifi_ssid);
  snap.has_ip = radio.state == WifiState::Connected;
  if (snap.has_ip)
  {
    const IPAddress ip = WiFi.localIP();
    std::snprintf(snap.ip, sizeof(snap.ip), "%u.%u.%u.%u", ip[0], ip[1], ip[2], ip[3]);
    snap.rssi = WiFi.RSSI();
    snap.rssi_known = true;
  }
  std::snprintf(snap.hostname, sizeof(snap.hostname), "%s", hostname);
  snap.time_synced = time_synced.load();
  Locked held(lock);
  // The result of the Improv try is written where it happens (set_provision) and kept as it is.
  snap.provision = published.provision;
  snap.provision_id = published.provision_id;
  published = snap;
}

void scan_networks()
{
  scan_state_value = ScanState::Running;
  const bool was_off = WiFi.getMode() == WIFI_OFF;
  radio_on();
  // The scan waits here, at most SCAN_TIMEOUT_MS (the library waits 60 s by default); one that runs longer is stopped
  // and finds nothing.
  WiFi.setScanTimeout(SCAN_TIMEOUT_MS);
  const int found = WiFi.scanNetworks(false, false);
  if (found == WIFI_SCAN_FAILED)
    esp_wifi_scan_stop();
  size_t count = 0;
  Network results[MAX_SCAN];
  // Every access point of the scan counts: one entry per name, the strongest, and the best MAX_SCAN names
  for (int i = 0; i < found; i++)
  {
    // The raw record: the name is the bytes of its 33-byte field up to the first zero, and a record with more bytes
    // after that zero (`Home\0Evil`) is not a name at all. scan_add judges the original bytes.
    const wifi_ap_record_t *record = static_cast<const wifi_ap_record_t *>(WiFi.getScanInfoByIndex(i));
    size_t length = 0;
    if (!record || !zenit::net::scan_ssid_length(
                       reinterpret_cast<const uint8_t (&)[zenit::net::MAX_SSID + 1]>(record->ssid), length))
      continue;
    zenit::net::scan_add(results, count, MAX_SCAN, reinterpret_cast<const char *>(record->ssid), length, record->rssi,
                         record->authmode != WIFI_AUTH_OPEN);
  }
  zenit::net::scan_sort(results, count);
  WiFi.scanDelete();
  if (was_off && !radio.active_ssid[0] && !radio.provisioning)
    radio_off();
  {
    Locked held(lock);
    std::memcpy(scan_results, results, count * sizeof(Network));
    scan_count = count;
  }
  scan_state_value = ScanState::Done;
}

// Records the result of the Improv request `id` where the loop task reads it.
void set_provision(uint32_t id, Provision result)
{
  Locked held(lock);
  published.provision = result;
  published.provision_id = id;
}

void start_provision(const Command &command, uint32_t now)
{
  radio.provision_id = command.id;
  // (the command's own copy of the password is wiped by run_command after this)
  std::snprintf(radio.try_ssid, sizeof(radio.try_ssid), "%s", command.ssid);
  std::snprintf(radio.try_password, sizeof(radio.try_password), "%s", command.password);
  radio.provisioning = true;
  radio.provision_started = now;
  set_provision(command.id, Provision::Trying);
  stop_services();
  use_credentials(radio.try_ssid, radio.try_password, now);
}

void run_provision(uint32_t now)
{
  if (!radio.provisioning)
    return;
  if (radio.state == WifiState::Connected)
  {
    // The new network works: the loop task stores it, and it stays the network of the radio.
    radio.provisioning = false;
    // The radio and, soon, the settings hold the password: this temporary copy is not kept
    std::memset(radio.try_password, 0, sizeof(radio.try_password));
    set_provision(radio.provision_id, Provision::Succeeded);
    start_services(millis());
    return;
  }
  if (now - radio.provision_started >= PROVISION_MS)
  {
    radio.provisioning = false;
    set_provision(radio.provision_id, Provision::Failed);
    std::memset(radio.try_password, 0, sizeof(radio.try_password));
    use_credentials(radio.board.wifi_ssid, radio.board.wifi_password, now);
  }
}

// Progress is a value the loop task reads, not an event: a slow loop task can never fill the queue with it, so the
// queue holds only the end of a transfer, and that always fits.
void post_progress(uint8_t percent) { progress_percent = percent; }

// The end of a transfer is delivered even when the queue is full for a moment: the loop task is behind, not gone.
void post_result(const UpdateEvent &event)
{
  while (!events.send(event, 1000))
    delay(10);
}

void run_command(const Command &command, uint32_t now)
{
  switch (command.type)
  {
  case Command::Type::Provision:
    start_provision(command, now);
    std::memset(const_cast<char *>(command.password), 0, sizeof(command.password));
    break;
  case Command::Type::Scan:
    scan_networks();
    break;
  case Command::Type::Manifest:
  {
    large = true;
    const update_worker::CheckResult found = update_worker::check(command.target, command.url);
    large = false;
    UpdateEvent event;
    event.type = UpdateEvent::Type::Manifest;
    event.target = command.target;
    event.result = found.result;
    event.manifest = found.manifest;
    post_result(event);
    break;
  }
  case Command::Type::Download:
  {
    large = true;
    UpdateEvent event;
    event.type = UpdateEvent::Type::Downloaded;
    event.target = command.target;
    event.result = update_worker::download(command.target, command.url, command.manifest, post_progress);
    large = false;
    post_result(event);
    break;
  }
  }
}

// Reports each new low of the network task's free stack, so a test on the board finds how much of it is used.
void report_stack()
{
  static uint32_t lowest = UINT32_MAX;
  const uint32_t free_bytes = platform::stack_free_min();
  if (free_bytes < lowest)
  {
    lowest = free_bytes;
    platform::log("network stack: %u bytes free at the lowest", static_cast<unsigned>(free_bytes));
  }
  static uint32_t lowest_heap = UINT32_MAX;
  const uint32_t heap_min = esp_get_minimum_free_heap_size();
  if (heap_min < lowest_heap)
  {
    lowest_heap = heap_min;
    platform::log("heap: %u bytes free now, %u at the lowest", static_cast<unsigned>(platform::memory_info().free),
                  static_cast<unsigned>(heap_min));
  }
}

void task(void *)
{
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  zenit::net::hostname_from_mac(mac, hostname);
  WiFi.onEvent(on_wifi_event);
  for (;;)
  {
    const uint32_t now = millis();
    take_config(now);
    Command command;
    if (commands.receive(command, 0))
      run_command(command, millis());
    run_provision(millis());
    if (radio.active_ssid[0])
      manage_connection(millis());
    publish();
    report_stack();
    delay(LOOP_MS);
  }
}
} // namespace

void begin(const zenit::net::BoardSettings &settings)
{
  if (started)
  {
    apply(settings);
    return;
  }
  started = true;
  ws_server::begin();
  {
    Locked held(lock);
    config = settings;
    config_generation = 1;
  }
  xTaskCreate(task, "network", TASK_STACK_BYTES, nullptr, 1, nullptr);
}

void apply(const zenit::net::BoardSettings &settings)
{
  Locked held(lock);
  config = settings;
  config_generation++;
}

Snapshot snapshot()
{
  Snapshot copy;
  {
    Locked held(lock);
    copy = published;
  }
  if (copy.time_synced)
    copy.epoch = static_cast<int64_t>(time(nullptr));
  return copy;
}

uint32_t provision(const char *ssid, const char *password)
{
  Command command;
  command.type = Command::Type::Provision;
  std::snprintf(command.ssid, sizeof(command.ssid), "%s", ssid);
  std::snprintf(command.password, sizeof(command.password), "%s", password);
  Locked held(lock);
  // One try at a time. The snapshot shows the new request as running at once, so the result of an earlier try is never
  // taken for this one.
  if (published.provision == Provision::Trying)
    return 0;
  command.id = ++provision_counter;
  const bool queued = commands.send(command, 0);
  std::memset(command.password, 0, sizeof(command.password));
  if (!queued)
    return 0;
  published.provision = Provision::Trying;
  published.provision_id = command.id;
  return command.id;
}

bool request_scan()
{
  switch (scan_state_value.load())
  {
  case ScanState::Running:
    return false;
  case ScanState::Idle:
  case ScanState::Done:
    break; // a new scan discards a result nobody has read
  }
  scan_state_value = ScanState::Running;
  Command command;
  command.type = Command::Type::Scan;
  if (!commands.send(command, 0))
  {
    scan_state_value = ScanState::Idle;
    return false;
  }
  return true;
}

ScanState scan_state() { return scan_state_value.load(); }

size_t take_scan(Network *out, size_t capacity)
{
  if (scan_state_value.load() != ScanState::Done)
    return 0;
  size_t count;
  {
    Locked held(lock);
    count = scan_count < capacity ? scan_count : capacity;
    std::memcpy(out, scan_results, count * sizeof(Network));
  }
  scan_state_value = ScanState::Idle;
  return count;
}

void close_client(uint16_t code) { ws_server::close_client(code); }

bool request_manifest(install_target::Target target, const char *url)
{
  if (transfer.exchange(true))
    return false;
  Command command;
  command.type = Command::Type::Manifest;
  command.target = target;
  std::snprintf(command.url, sizeof(command.url), "%s", url);
  if (!commands.send(command, 0))
  {
    transfer = false;
    return false;
  }
  return true;
}

bool request_download(install_target::Target target, const char *manifest_url, const zenit::update::Manifest &manifest)
{
  if (transfer.exchange(true))
    return false;
  Command command;
  command.type = Command::Type::Download;
  command.target = target;
  std::snprintf(command.url, sizeof(command.url), "%s", manifest_url);
  command.manifest = manifest;
  if (!commands.send(command, 0))
  {
    transfer = false;
    return false;
  }
  return true;
}

bool holds_large_allocation() { return large.load(); }

void poll(uint64_t now)
{
  ws_server::poll(now);
  const int percent = progress_percent.exchange(-1);
  if (percent >= 0)
    updates::on_progress(static_cast<uint8_t>(percent));
  UpdateEvent event;
  for (int handled = 0; handled < 4 && events.receive(event, 0); handled++)
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
}

} // namespace network

#endif
