// SPDX-License-Identifier: GPL-3.0-or-later

#include "improv.h"

#include <board_settings.h>
#include <improv_frame.h>
#include <scan_list.h>

#include <algorithm>
#include <cstring>
#include <vector>

#include "network.h"
#include "platform.h"
#include "settings.h"

namespace improv_link
{

namespace
{
using zenit::improv::Command;
using zenit::improv::Error;
using zenit::improv::State;

// A connection started by "send WiFi settings" answers within this time.
constexpr uint32_t CONNECT_TIMEOUT_MS = 30000;
// A scan answers within this time, with what it has.
constexpr uint32_t SCAN_TIMEOUT_MS = 15000;
constexpr size_t MAX_RESULTS = 16;

enum class Pending : uint8_t
{
  None,
  Connect,
  Scan
};

Pending pending = Pending::None;
uint64_t pending_since = 0;
// The credentials of the connection in progress, kept until it succeeds and they are stored.
std::string try_ssid, try_password;
// The id of the network task request that tries them: only a result with this id is theirs.
uint32_t try_id = 0;

void to_nowhere(const std::string &) {}
Sink sink = to_nowhere;

void send(const std::string &frame) { sink(frame); }

State state_now()
{
  const network::Snapshot net = network::snapshot();
  // Provisioning only while a connection asked for by Improv runs: a board that reconnects to its stored network by
  // itself is not set up by Improv, and reports ready until it is connected
  if (pending == Pending::Connect)
    return State::Provisioning;
  return net.state == zenit::net::WifiState::Connected ? State::Provisioned : State::Ready;
}

std::string chip_name()
{
  const std::string board = platform::board_name();
  return board == "esp32c3" ? "ESP32-C3" : board;
}

void forget_attempt()
{
  zenit::improv::wipe(try_ssid);
  zenit::improv::wipe(try_password);
}

void send_scan()
{
  network::Network taken[network::MAX_SCAN];
  const size_t taken_count = network::take_scan(taken, network::MAX_SCAN);
  // One result per network name, for its strongest access point, strongest first
  network::Network found[network::MAX_SCAN];
  size_t count = 0;
  for (size_t i = 0; i < taken_count; i++)
    zenit::net::scan_add(found, count, network::MAX_SCAN, taken[i].ssid, std::strlen(taken[i].ssid), taken[i].rssi,
                         taken[i].secure);
  zenit::net::scan_sort(found, count);
  for (size_t i = 0; i < count && i < MAX_RESULTS; i++)
    send(zenit::improv::result_packet(Command::ScanNetworks,
                                      {found[i].ssid, std::to_string(found[i].rssi), found[i].secure ? "YES" : "NO"}));
  send(zenit::improv::result_packet(Command::ScanNetworks, {}));
}

void handle_wifi_settings(const std::string &args, uint64_t now)
{
  if (pending != Pending::None)
  {
    // One operation at a time: a scan or a connection is running, and it keeps its state
    send(zenit::improv::error_packet(Error::UnableToConnect));
    send(zenit::improv::state_packet(state_now()));
    return;
  }
  std::string ssid, password;
  if (!zenit::improv::parse_wifi_settings(args, ssid, password) || !zenit::net::valid_wifi_name(ssid.c_str()) ||
      !zenit::net::valid_wifi_password(password.c_str()))
  {
    send(zenit::improv::error_packet(Error::InvalidRpc));
    zenit::improv::wipe(ssid);
    zenit::improv::wipe(password);
    return;
  }
  send(zenit::improv::state_packet(State::Provisioning));
  const uint32_t id = network::provision(ssid.c_str(), password.c_str());
  if (id == 0)
  {
    send(zenit::improv::error_packet(Error::UnableToConnect));
    send(zenit::improv::state_packet(State::Ready));
    zenit::improv::wipe(ssid);
    zenit::improv::wipe(password);
    return;
  }
  try_ssid = ssid;
  try_password = password;
  try_id = id;
  pending = Pending::Connect;
  pending_since = now;
  zenit::improv::wipe(ssid);
  zenit::improv::wipe(password);
}

void finish_connect()
{
  // The network works: store it, then tell the network task to keep it.
  zenit::net::BoardSettings next = settings::board();
  std::strncpy(next.wifi_ssid, try_ssid.c_str(), sizeof(next.wifi_ssid) - 1);
  next.wifi_ssid[sizeof(next.wifi_ssid) - 1] = '\0';
  std::strncpy(next.wifi_password, try_password.c_str(), sizeof(next.wifi_password) - 1);
  next.wifi_password[sizeof(next.wifi_password) - 1] = '\0';
  forget_attempt();
  pending = Pending::None;
  if (settings::commit_board(next) != settings::Commit::Ok)
  {
    // A network that would be lost at the next restart is not a success: the radio goes back to the stored network
    platform::log("the WiFi network could not be saved");
    network::apply(settings::board());
    send(zenit::improv::error_packet(Error::UnableToConnect));
    send(zenit::improv::state_packet(State::Ready));
    return;
  }
  network::apply(settings::board());
  send(zenit::improv::state_packet(State::Provisioned));
  send(zenit::improv::result_packet(Command::WifiSettings, {}));
}
} // namespace

void set_sink(Sink replacement) { sink = replacement ? replacement : Sink(to_nowhere); }

void begin()
{
  pending = Pending::None;
  forget_attempt();
}

bool connecting() { return pending == Pending::Connect; }

void handle_frame(uint8_t type, const std::string &data, uint64_t now)
{
  using zenit::improv::Type;
  if (type != static_cast<uint8_t>(Type::RpcCommand) || data.size() < 2 ||
      static_cast<uint8_t>(data[1]) != data.size() - 2)
  {
    send(zenit::improv::error_packet(Error::InvalidRpc));
    return;
  }
  send(zenit::improv::error_packet(Error::None));
  std::string args = data.substr(2);
  switch (static_cast<uint8_t>(data[0]))
  {
  case static_cast<uint8_t>(Command::WifiSettings):
    handle_wifi_settings(args, now);
    break;
  case static_cast<uint8_t>(Command::CurrentState):
  {
    const State state = state_now();
    send(zenit::improv::state_packet(state));
    if (state == State::Provisioned)
      send(zenit::improv::result_packet(Command::WifiSettings, {}));
    break;
  }
  case static_cast<uint8_t>(Command::DeviceInfo):
    send(zenit::improv::result_packet(
        Command::DeviceInfo, {"Zenit", platform::firmware_version(), chip_name(), network::snapshot().hostname}));
    break;
  case static_cast<uint8_t>(Command::ScanNetworks):
    // A scan during a scan or a connection would take its place: it gets the empty result
    if (pending == Pending::None && network::request_scan())
    {
      pending = Pending::Scan;
      pending_since = now;
    }
    else
      send(zenit::improv::result_packet(Command::ScanNetworks, {}));
    break;
  default:
    send(zenit::improv::error_packet(Error::UnknownRpc));
  }
  zenit::improv::wipe(args);
}

void handle_bad_checksum() { send(zenit::improv::error_packet(Error::InvalidRpc)); }

void poll(uint64_t now)
{
  if (pending == Pending::None)
    return;
  const uint64_t waited = now - pending_since;
  if (pending == Pending::Connect)
  {
    const network::Snapshot net = network::snapshot();
    // A result left by an earlier try carries another id and is not ours.
    const network::Provision provision = net.provision_id == try_id ? net.provision : network::Provision::Trying;
    if (provision == network::Provision::Succeeded)
      finish_connect();
    else if (provision == network::Provision::Failed || waited >= CONNECT_TIMEOUT_MS)
    {
      forget_attempt();
      pending = Pending::None;
      send(zenit::improv::error_packet(Error::UnableToConnect));
      send(zenit::improv::state_packet(State::Ready));
    }
  }
  else if (network::scan_state() == network::ScanState::Done || waited >= SCAN_TIMEOUT_MS)
  {
    pending = Pending::None;
    send_scan();
  }
}

} // namespace improv_link
