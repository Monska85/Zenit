// SPDX-License-Identifier: GPL-3.0-or-later

#ifdef ZENIT_SIM

#include "sim_control.h"

#include <semver.h>
#include <sha256.h>
#include <update_record.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <sstream>
#include <vector>

#include "app.h"
#include "firmware.h"
#include "network.h"
#include "platform.h"
#include "protocol.h"
#include "settings.h"
#include "update_http.h"
#include "updates.h"

namespace sim_control
{

namespace
{
std::string rest_after(const std::string &line, const std::string &prefix)
{
  return line.size() > prefix.size() ? line.substr(prefix.size()) : std::string();
}

void complain(const std::string &line, const char *why)
{
  std::fprintf(stderr, "zenit-sim: '%s' refused: %s\n", line.c_str(), why);
}

// `key=value` words of a control line.
std::map<std::string, std::string> words(const std::string &text)
{
  std::map<std::string, std::string> out;
  std::istringstream in(text);
  std::string word;
  while (in >> word)
  {
    const size_t eq = word.find('=');
    if (eq != std::string::npos)
      out[word.substr(0, eq)] = word.substr(eq + 1);
  }
  return out;
}

bool state_from_name(const std::string &name, zenit::net::WifiState &out)
{
  for (int i = 0; i <= static_cast<int>(zenit::net::WifiState::NoAddress); i++)
    if (name == zenit::net::wifi_state_name(static_cast<zenit::net::WifiState>(i)))
    {
      out = static_cast<zenit::net::WifiState>(i);
      return true;
    }
  return false;
}

void net_line(const std::string &line, uint64_t now)
{
  network::Snapshot snapshot = network::snapshot();
  const auto w = words(rest_after(line, "!net"));
  for (const auto &[key, value] : w)
  {
    if (key == "state")
    {
      if (!state_from_name(value, snapshot.state))
        return complain(line, "unknown state");
    }
    else if (key == "ssid")
    {
      if (!value.empty() && !zenit::net::valid_wifi_name_bytes(value.data(), value.size()))
        return complain(line, "a network name of 1 to 32 bytes");
      std::snprintf(snapshot.ssid, sizeof(snapshot.ssid), "%s", value.c_str());
    }
    else if (key == "rssi")
    {
      snapshot.rssi = std::atoi(value.c_str());
      snapshot.rssi_known = true;
    }
    else if (key == "ip")
    {
      std::snprintf(snapshot.ip, sizeof(snapshot.ip), "%s", value.c_str());
      snapshot.has_ip = !value.empty();
    }
    else if (key == "synced")
      snapshot.time_synced = value == "1";
    else if (key == "epoch")
      network::sim_set_epoch_base(std::atoll(value.c_str()) - static_cast<int64_t>(now / 1000));
    else
      return complain(line, "unknown key");
  }
  network::sim_set_snapshot(snapshot);
}

void announce(const char *line);

void update_line(const std::string &line)
{
  const std::string rest = rest_after(line, "!update ");
  if (rest.rfind("manifest ", 0) == 0)
    update_http::sim_set_manifest(rest.substr(9).c_str());
  else if (rest.rfind("fail ", 0) == 0)
  {
    const std::string what = rest.substr(5);
    using update_http::Outcome;
    Outcome outcome;
    if (what == "unreachable")
      outcome = Outcome::Unreachable;
    else if (what == "not_published")
      outcome = Outcome::NotPublished;
    else if (what == "tls_error")
      outcome = Outcome::TlsError;
    else
      return complain(line, "expected unreachable, not_published or tls_error");
    update_http::sim_set_manifest_outcome(outcome);
  }
  else if (rest.rfind("firmware ", 0) == 0)
  {
    // `firmware SIZE FILL`: a file of SIZE bytes of the byte FILL, and its SHA-256 on standard output.
    std::istringstream in(rest.substr(9));
    size_t size = 0;
    int fill = 0;
    if (!(in >> size >> fill) || size == 0 || size > 4u * 1024 * 1024)
      return complain(line, "expected SIZE FILL");
    const std::vector<uint8_t> file(size, static_cast<uint8_t>(fill));
    update_http::sim_set_firmware(file.data(), file.size());
    zenit::net::Sha256 hash;
    hash.update(file.data(), file.size());
    uint8_t digest[zenit::net::SHA256_SIZE];
    hash.finish(digest);
    char hex[zenit::net::SHA256_HEX + 1];
    zenit::net::to_hex(digest, hex);
    char out[80];
    std::snprintf(out, sizeof(out), "!sha256 %s\n", hex);
    announce(out);
  }
  else if (rest.rfind("download ", 0) == 0)
  {
    const std::string what = rest.substr(9);
    update_http::sim_set_download_outcome(what == "ok"            ? update_http::Outcome::Ok
                                          : what == "unreachable" ? update_http::Outcome::Unreachable
                                          : what == "tls_error"   ? update_http::Outcome::TlsError
                                                                  : update_http::Outcome::BadDownload);
  }
  else
    complain(line, "unknown update control");
}

void firmware_line(const std::string &line)
{
  const std::string rest = rest_after(line, "!firmware ");
  if (rest.rfind("trial ", 0) == 0)
    firmware::sim_set_trial(rest.substr(6) == "1");
  else if (rest.rfind("invalid ", 0) == 0)
    firmware::sim_set_other_invalid(rest.substr(8) == "1");
  else if (rest.rfind("fail ", 0) == 0)
    firmware::sim_fail(rest.substr(5) == "none" ? "" : rest.substr(5).c_str());
  else
    complain(line, "unknown firmware control");
}

// A restart: the board starts again. A new image (activated by an install) boots on trial and reports its version.
bool quiet = false;

void announce(const char *line)
{
  if (!quiet)
  {
    std::fputs(line, stdout);
    std::fflush(stdout);
  }
}

// `how` is empty for a restart into the installed image (it boots on trial and reports its version), "rollback" for one
// where the bootloader went back to the running image because the new one failed its trial, and "lost" for a power cut
// before the new image became the boot image.
void restart(uint64_t now, const std::string &how = "")
{
  const bool new_image = firmware::sim_activated() && how.empty();
  const std::string pending = settings::update_record().pending;
  // A slot marked invalid by an earlier rollback stays so across restarts.
  const bool was_invalid = firmware::other_slot_invalid();
  firmware::sim_reset();
  if (was_invalid)
    firmware::sim_set_other_invalid(true);
  if (new_image)
  {
    firmware::sim_set_trial(true);
    if (!pending.empty())
      platform::sim_set_version(pending.c_str());
  }
  else if (how == "rollback")
  {
    // The new image started, stored that it did, and failed its trial.
    firmware::sim_set_other_invalid(true);
    zenit::update::UpdateRecord record = settings::update_record();
    record.booted = true;
    (void)settings::commit_update(record);
  }
  settings::begin();
  app::begin(now, 1);
  protocol::begin(platform::random32());
  updates::protocol_ready();
  app::tick(now);
  announce("!restarted\n");
}
} // namespace

bool handle(const std::string &line, uint64_t now)
{
  if (line.rfind("!net", 0) == 0)
    net_line(line, now);
  else if (line.rfind("!update ", 0) == 0)
    update_line(line);
  else if (line.rfind("!firmware ", 0) == 0)
    firmware_line(line);
  else if (line == "!restart")
    restart(now);
  else if (line == "!restart rollback" || line == "!restart lost")
    restart(now, rest_after(line, "!restart "));
  else if (line.rfind("!version ", 0) == 0)
  {
    const std::string version = rest_after(line, "!version ");
    zenit::update::Version parsed;
    if (!zenit::update::parse_version(version.c_str(), parsed))
      return complain(line, "expected a semantic version of at most 47 characters"), true;
    platform::sim_set_version(version.c_str());
  }
  else if (line.rfind("!random ", 0) == 0)
  {
    // `!random HEX`: the bytes the next random draws return (a login nonce, a token).
    const std::string hex = rest_after(line, "!random ");
    std::vector<uint8_t> bytes;
    for (size_t i = 0; i + 1 < hex.size(); i += 2)
      bytes.push_back(static_cast<uint8_t>(std::stoi(hex.substr(i, 2), nullptr, 16)));
    platform::sim_queue_random_bytes(bytes.data(), bytes.size());
  }
  else if (line.rfind("!token ", 0) == 0)
  {
    zenit::net::BoardSettings next = settings::board();
    // Judged as typed, before it is copied: a longer text is not a token cut to 16 characters
    const std::string token = rest_after(line, "!token ");
    if (!zenit::net::valid_token(token.c_str()))
      return complain(line, "expected 16 characters of a-z and 0-9"), true;
    std::snprintf(next.token, sizeof(next.token), "%s", token.c_str());
    if (settings::commit_board(next) != settings::Commit::Ok)
      complain(line, "the settings could not be saved");
  }
  else if (line.rfind("!store-wifi ", 0) == 0)
  {
    // `!store-wifi ssid=NAME password=TEXT`: what a finished Improv setup leaves.
    const auto w = words(rest_after(line, "!store-wifi "));
    zenit::net::BoardSettings next = settings::board();
    // Judged as typed: a name or password that does not fit is refused, not cut
    const std::string ssid = w.count("ssid") ? w.at("ssid") : "";
    const std::string password = w.count("password") ? w.at("password") : "";
    if ((!ssid.empty() && !zenit::net::valid_wifi_name_bytes(ssid.data(), ssid.size())) ||
        !zenit::net::valid_wifi_password(password.c_str()))
      return complain(line, "a network name of 1 to 32 bytes and a valid password"), true;
    std::snprintf(next.wifi_ssid, sizeof(next.wifi_ssid), "%s", ssid.c_str());
    std::snprintf(next.wifi_password, sizeof(next.wifi_password), "%s", password.c_str());
    if (settings::commit_board(next) != settings::Commit::Ok)
      complain(line, "the settings could not be saved");
    else
      network::apply(settings::board());
  }
  else if (line == "!scan-list")
  {
    // `!scan-list` prints the list a scan would give, strongest first: `!scan-list NAME RSSI YES|NO` for each
    network::Network list[network::MAX_SCAN];
    const size_t count = network::sim_scan_list(list, network::MAX_SCAN);
    for (size_t i = 0; i < count; i++)
    {
      char out[96];
      std::snprintf(out, sizeof(out), "!scan-list %s %d %s\n", list[i].ssid, list[i].rssi,
                    list[i].secure ? "YES" : "NO");
      announce(out);
    }
    announce("!scan-list end\n");
  }
  else if (line.rfind("!scan ", 0) == 0 || line == "!scan")
  {
    // `!scan NAME:RSSI:YES|NO ...`
    std::vector<network::SimAccessPoint> found;
    std::istringstream in(rest_after(line, "!scan"));
    std::string item;
    // Every access point goes to the simulator, which ranks them and keeps the best 16 names as the board does
    while (in >> item)
    {
      const size_t a = item.find(':'), b = item.rfind(':');
      if (a == std::string::npos || a == b)
        return complain(line, "expected NAME:RSSI:YES|NO"), true;
      // The name goes on as the bytes it is, of whatever length: the scan list judges it
      found.push_back(
          {item.substr(0, a), std::atoi(item.substr(a + 1, b - a - 1).c_str()), item.substr(b + 1) == "YES"});
    }
    network::sim_set_scan(found);
  }
  else
    return false;
  return true;
}

void after_step(uint64_t now)
{
  if (firmware::sim_restarted())
    restart(now);
  if (network::sim_take_close_client())
    announce("!close-client\n");
}

void set_quiet(bool value) { quiet = value; }

} // namespace sim_control

#endif
