// SPDX-License-Identifier: GPL-3.0-or-later

// Unit tests of the network glue beyond the conformance cases: the settings records, Improv over the network API, the
// update flow's trial and failure paths, and the login state of the protocol core.

#include <unity.h>

#include <frame.h>
#include <improv_frame.h>
#include <origin_scan.h>
#include <schedule.h>
#include <sha256.h>
#include <web_image.h>

#include <cstring>
#include <string>
#include <vector>

#include "app.h"
#include "firmware.h"
#include "improv.h"
#include "network.h"
#include "output.h"
#include "platform.h"
#include "protocol.h"
#include "settings.h"
#include "sim_control.h"
#include "update_http.h"
#include "updates.h"
#include "www.h"
#include "zenit_test.h"

namespace improv = zenit::improv;
namespace net = zenit::net;

namespace
{
std::vector<std::string> frames;

void capture_frame(const std::string &frame) { frames.push_back(frame); }

std::string rpc(uint8_t command, const std::string &args = "")
{
  std::string data;
  data += static_cast<char>(command);
  data += static_cast<char>(args.size());
  data += args;
  return data;
}

std::string wifi_args(const std::string &ssid, const std::string &password)
{
  std::string args;
  args += static_cast<char>(ssid.size());
  args += ssid;
  args += static_cast<char>(password.size());
  args += password;
  return args;
}

const std::string STATE_PROVISIONING = improv::state_packet(improv::State::Provisioning);
const std::string STATE_READY = improv::state_packet(improv::State::Ready);
const std::string STATE_PROVISIONED = improv::state_packet(improv::State::Provisioned);
const std::string NO_ERROR = improv::error_packet(improv::Error::None);

void run_ms(uint64_t &now, uint64_t ms)
{
  const uint64_t until = now + ms;
  for (now += zenit::TICK_MS; now <= until; now += zenit::TICK_MS)
  {
    platform::sim_set_now_ms(now);
    app::tick(now);
    app::service(now);
    sim_control::after_step(now);
  }
  now = until;
  platform::sim_set_now_ms(now);
}

uint64_t now = 0;
} // namespace

void setUp()
{
  platform::sim_set_log(false);
  sim_control::set_quiet(true);
  settings::sim_fail_writes(false);
  settings::sim_fail_key("");
  settings::sim_clear();
  settings::begin();
  firmware::sim_reset();
  update_http::sim_reset();
  www::sim_reset();
  platform::sim_set_version("0.1.0");
  platform::sim_set_now_ms(0);
  now = 0;
  app::begin(0, 1);
  protocol::begin(1);
  updates::protocol_ready();
  frames.clear();
  improv_link::set_sink(capture_frame);
}
void tearDown() { improv_link::set_sink(nullptr); }

// ---- Settings records ----

void test_the_token_is_made_once_and_kept_across_starts()
{
  const std::string first = settings::board().token;
  TEST_ASSERT_TRUE(net::valid_token(first.c_str()));
  settings::begin();
  TEST_ASSERT_EQUAL_STRING(first.c_str(), settings::board().token);
}

void test_board_settings_survive_a_restart()
{
  net::BoardSettings next = settings::board();
  next.update_mode = net::UpdateMode::Notify;
  std::strcpy(next.wifi_ssid, "HomeNet");
  std::strcpy(next.wifi_password, "correct-horse");
  TEST_ASSERT_TRUE(settings::commit_board(next) == settings::Commit::Ok);
  settings::begin();
  TEST_ASSERT_TRUE(settings::board() == next);
}

void test_a_damaged_board_record_gives_defaults_and_a_new_token()
{
  settings::sim_write_raw("settings", std::vector<uint8_t>(100, 0xFF));
  settings::begin();
  TEST_ASSERT_TRUE(net::valid_token(settings::board().token));
  TEST_ASSERT_TRUE(settings::board().update_mode == net::UpdateMode::Automatic);
  // and the token was written, so the next start has the same one
  const std::string token = settings::board().token;
  settings::begin();
  TEST_ASSERT_EQUAL_STRING(token.c_str(), settings::board().token);
}

void test_a_commit_of_both_records_is_all_or_nothing()
{
  zenit::LightSettings light = settings::current();
  light.brightness = 33;
  net::BoardSettings board = settings::board();
  board.check_hours = 12;
  // The two records are one write: when it fails nothing changed, in memory or in the stored blob
  settings::sim_fail_key("settings");
  TEST_ASSERT_TRUE(settings::commit_both(light, board) == settings::Commit::Failed);
  TEST_ASSERT_EQUAL_UINT8(6, settings::board().check_hours);
  TEST_ASSERT_EQUAL_UINT8(60, settings::current().brightness);
  settings::sim_fail_key("");
  settings::begin(); // a restart after the failed save
  TEST_ASSERT_EQUAL_UINT8(6, settings::board().check_hours);
  TEST_ASSERT_EQUAL_UINT8(60, settings::current().brightness);
  TEST_ASSERT_TRUE(settings::commit_both(light, board) == settings::Commit::Ok);
  settings::begin(); // and after the saved one
  TEST_ASSERT_EQUAL_UINT8(33, settings::current().brightness);
  TEST_ASSERT_EQUAL_UINT8(12, settings::board().check_hours);
}

void test_a_light_only_or_board_only_commit_keeps_the_other_record()
{
  zenit::LightSettings light = settings::current();
  light.brightness = 44;
  TEST_ASSERT_TRUE(settings::commit(light) == settings::Commit::Ok);
  net::BoardSettings board = settings::board();
  board.check_hours = 9;
  TEST_ASSERT_TRUE(settings::commit_board(board) == settings::Commit::Ok);
  settings::begin();
  TEST_ASSERT_EQUAL_UINT8(44, settings::current().brightness);
  TEST_ASSERT_EQUAL_UINT8(9, settings::board().check_hours);
}

void test_the_records_of_a_board_from_before_the_blob_are_read_and_replaced()
{
  settings::sim_clear();
  // The light record of brightness 80 and the breathing effect, and a board record with check_hours 12 and a token
  std::vector<uint8_t> light = {1, 80, 2, 0, 4, 1, 2, 3, 0, 0, 30, 0, 8, 20, 20, 0, 0};
  net::BoardSettings stored;
  stored.check_hours = 12;
  std::strcpy(stored.token, "abcdefghij012345");
  uint8_t board[net::BOARD_RECORD_SIZE];
  net::encode_board_record(stored, board);
  settings::sim_write_raw("light", light);
  settings::sim_write_raw("board", std::vector<uint8_t>(board, board + sizeof(board)));
  settings::begin();
  TEST_ASSERT_EQUAL_UINT8(80, settings::current().brightness);
  TEST_ASSERT_EQUAL_UINT8(12, settings::board().check_hours);
  TEST_ASSERT_EQUAL_STRING("abcdefghij012345", settings::board().token);
  // The next save writes the blob, and from then on the blob is what is read
  zenit::LightSettings next = settings::current();
  next.brightness = 70;
  TEST_ASSERT_TRUE(settings::commit(next) == settings::Commit::Ok);
  settings::sim_write_raw("light", {1, 10});
  settings::begin();
  TEST_ASSERT_EQUAL_UINT8(70, settings::current().brightness);
  TEST_ASSERT_EQUAL_UINT8(12, settings::board().check_hours);
}

void test_a_blob_of_the_wrong_size_gives_the_defaults_and_a_new_token()
{
  settings::sim_write_raw("settings", std::vector<uint8_t>(200, 1));
  settings::begin();
  TEST_ASSERT_EQUAL_UINT8(60, settings::current().brightness);
  TEST_ASSERT_TRUE(net::valid_token(settings::board().token));
  TEST_ASSERT_EQUAL_UINT8(6, settings::board().check_hours);
}

void test_nothing_is_written_when_no_setting_differs()
{
  const size_t before = settings::sim_write_count();
  TEST_ASSERT_TRUE(settings::commit_both(settings::current(), settings::board()) == settings::Commit::Ok);
  TEST_ASSERT_EQUAL_size_t(before, settings::sim_write_count());
}

// ---- Improv over the network API ----

void test_improv_reports_its_state_and_device_info()
{
  improv_link::handle_frame(3, rpc(2), now);
  TEST_ASSERT_EQUAL_size_t(2, frames.size());
  TEST_ASSERT_EQUAL_STRING(NO_ERROR.c_str(), frames[0].c_str());
  TEST_ASSERT_EQUAL_STRING(STATE_READY.c_str(), frames[1].c_str());
  frames.clear();
  improv_link::handle_frame(3, rpc(3), now);
  TEST_ASSERT_EQUAL_size_t(2, frames.size());
  // The simulator's chip is not an ESP32-C3, so the chip name is the board name; the other three strings are fixed
  const std::string info = improv::result_packet(
      improv::Command::DeviceInfo, {"Zenit", platform::firmware_version(), platform::board_name(), "zenit-0000"});
  TEST_ASSERT_EQUAL_STRING(info.c_str(), frames[1].c_str());
}

void test_improv_says_ready_while_the_board_reconnects_by_itself_and_provisioning_only_while_it_runs()
{
  // The stored network is being joined (boot, or after a failed setup): no Improv connection runs
  net::BoardSettings board = settings::board();
  std::strcpy(board.wifi_ssid, "HomeNet");
  std::strcpy(board.wifi_password, "correct-horse");
  TEST_ASSERT_TRUE(settings::commit_board(board) == settings::Commit::Ok);
  network::apply(settings::board());
  TEST_ASSERT_TRUE(network::snapshot().state == net::WifiState::Connecting);
  improv_link::handle_frame(3, rpc(2), now);
  TEST_ASSERT_EQUAL_STRING(STATE_READY.c_str(), frames[1].c_str());
  // After a failed attempt of Improv the board is ready again, not provisioning
  network::sim_set_provision_succeeds(false);
  frames.clear();
  improv_link::handle_frame(3, rpc(1, wifi_args("Other", "another-pass1")), now);
  TEST_ASSERT_EQUAL_STRING(STATE_PROVISIONING.c_str(), frames[1].c_str());
  frames.clear();
  improv_link::handle_frame(3, rpc(2), now);
  TEST_ASSERT_EQUAL_STRING(STATE_PROVISIONING.c_str(), frames[1].c_str());
  run_ms(now, 1500);
  frames.clear();
  improv_link::handle_frame(3, rpc(2), now);
  TEST_ASSERT_EQUAL_STRING(STATE_READY.c_str(), frames[1].c_str());
  network::sim_set_provision_succeeds(true);
}

void test_improv_refuses_bad_frames_and_commands()
{
  improv_link::handle_frame(1, rpc(2), now); // a state packet is not a command
  TEST_ASSERT_EQUAL_STRING(improv::error_packet(improv::Error::InvalidRpc).c_str(), frames.back().c_str());
  frames.clear();
  improv_link::handle_frame(3, std::string("\x02\x05", 2), now); // a length that does not match
  TEST_ASSERT_EQUAL_STRING(improv::error_packet(improv::Error::InvalidRpc).c_str(), frames.back().c_str());
  frames.clear();
  improv_link::handle_frame(3, rpc(9), now);
  TEST_ASSERT_EQUAL_STRING(improv::error_packet(improv::Error::UnknownRpc).c_str(), frames.back().c_str());
  frames.clear();
  improv_link::handle_bad_checksum();
  TEST_ASSERT_EQUAL_STRING(improv::error_packet(improv::Error::InvalidRpc).c_str(), frames.back().c_str());
}

void test_improv_scan_sorts_dedupes_and_ends_with_an_empty_result()
{
  network::Network found[4] = {{"Far", -80, true}, {"Near", -40, true}, {"Far", -60, true}, {"Open", -70, false}};
  network::sim_set_scan(found, 4);
  improv_link::handle_frame(3, rpc(4), now);
  frames.clear();
  run_ms(now, 20);
  std::vector<std::string> want = {
      improv::result_packet(improv::Command::ScanNetworks, {"Near", "-40", "YES"}),
      improv::result_packet(improv::Command::ScanNetworks, {"Far", "-60", "YES"}),
      improv::result_packet(improv::Command::ScanNetworks, {"Open", "-70", "NO"}),
      improv::result_packet(improv::Command::ScanNetworks, {}),
  };
  TEST_ASSERT_EQUAL_size_t(want.size(), frames.size());
  for (size_t i = 0; i < want.size(); i++)
    TEST_ASSERT_EQUAL_STRING(want[i].c_str(), frames[i].c_str());
}

void test_a_scan_drops_the_names_that_cannot_be_reported()
{
  network::Network found[4] = {{"Good", -60, true},
                               {"a\x01"
                                "b",
                                -30, true},
                               {"\xff\xfe", -20, true},
                               {"Also good", -70, false}};
  network::sim_set_scan(found, 4);
  improv_link::handle_frame(3, rpc(4), now);
  frames.clear();
  run_ms(now, 30);
  TEST_ASSERT_EQUAL_size_t(3, frames.size());
  TEST_ASSERT_EQUAL_STRING(improv::result_packet(improv::Command::ScanNetworks, {"Good", "-60", "YES"}).c_str(),
                           frames[0].c_str());
  TEST_ASSERT_EQUAL_STRING(improv::result_packet(improv::Command::ScanNetworks, {"Also good", "-70", "NO"}).c_str(),
                           frames[1].c_str());
}

void test_a_scan_of_many_access_points_keeps_the_strongest_names_as_the_board_does()
{
  // 16 names at -80, then a stronger access point of one of them and a stronger new name, then a weaker new name
  std::vector<network::Network> found;
  for (int i = 0; i < 16; i++)
  {
    network::Network n = {};
    std::snprintf(n.ssid, sizeof(n.ssid), "N%d", i);
    n.rssi = -80;
    n.secure = true;
    found.push_back(n);
  }
  found.push_back({"N3", -30, true});
  found.push_back({"Late", -20, true});
  found.push_back({"Weak", -90, true});
  network::sim_set_scan(found.data(), found.size());
  improv_link::handle_frame(3, rpc(4), now);
  frames.clear();
  run_ms(now, 30);
  // 16 names and the empty result; N0 (the first of the weakest) went for Late, and Weak never got in
  TEST_ASSERT_EQUAL_size_t(17, frames.size());
  TEST_ASSERT_EQUAL_STRING(improv::result_packet(improv::Command::ScanNetworks, {"Late", "-20", "YES"}).c_str(),
                           frames[0].c_str());
  TEST_ASSERT_EQUAL_STRING(improv::result_packet(improv::Command::ScanNetworks, {"N3", "-30", "YES"}).c_str(),
                           frames[1].c_str());
  TEST_ASSERT_EQUAL_STRING(improv::result_packet(improv::Command::ScanNetworks, {"N1", "-80", "YES"}).c_str(),
                           frames[2].c_str());
  for (const std::string &frame : frames)
  {
    TEST_ASSERT_TRUE(frame.find("N0") == std::string::npos);
    TEST_ASSERT_TRUE(frame.find("Weak") == std::string::npos);
  }
}

void test_improv_stores_the_network_only_after_it_connected_and_blinks_meanwhile()
{
  improv_link::handle_frame(3, rpc(1, wifi_args("HomeNet", "correct-horse")), now);
  // The status shows the stored network only: not the one that is being tried
  TEST_ASSERT_EQUAL_STRING("", network::snapshot().ssid);
  TEST_ASSERT_EQUAL_STRING(NO_ERROR.c_str(), frames[0].c_str());
  TEST_ASSERT_EQUAL_STRING(STATE_PROVISIONING.c_str(), frames[1].c_str());
  TEST_ASSERT_TRUE(improv_link::connecting());
  TEST_ASSERT_EQUAL_STRING("", settings::board().wifi_ssid);
  // The board LED blinks at 2 Hz while the connection is made: on for 250 ms, off for 250 ms
  bool saw_on = false, saw_off = false;
  for (int i = 0; i < 60 && improv_link::connecting(); i++)
  {
    run_ms(now, 25);
    if (!improv_link::connecting())
      break;
    (output::sim_status_led() ? saw_on : saw_off) = true;
  }
  TEST_ASSERT_TRUE(saw_on);
  TEST_ASSERT_TRUE(saw_off);
  // The simulated try succeeded: the network is stored, the state and the empty result follow, the LED is off
  TEST_ASSERT_EQUAL_STRING("HomeNet", settings::board().wifi_ssid);
  TEST_ASSERT_EQUAL_STRING("HomeNet", network::snapshot().ssid); // shown once it is stored
  TEST_ASSERT_EQUAL_STRING("correct-horse", settings::board().wifi_password);
  TEST_ASSERT_EQUAL_STRING(STATE_PROVISIONED.c_str(), frames[frames.size() - 2].c_str());
  TEST_ASSERT_EQUAL_STRING(improv::result_packet(improv::Command::WifiSettings, {}).c_str(), frames.back().c_str());
  TEST_ASSERT_FALSE(output::sim_status_led());
}

void test_improv_does_not_store_a_network_that_failed()
{
  network::sim_set_provision_succeeds(false);
  improv_link::handle_frame(3, rpc(1, wifi_args("HomeNet", "wrong-pass1")), now);
  frames.clear();
  run_ms(now, 1500);
  TEST_ASSERT_EQUAL_STRING("", settings::board().wifi_ssid);
  TEST_ASSERT_EQUAL_size_t(2, frames.size());
  TEST_ASSERT_EQUAL_STRING(improv::error_packet(improv::Error::UnableToConnect).c_str(), frames[0].c_str());
  TEST_ASSERT_EQUAL_STRING(STATE_READY.c_str(), frames[1].c_str());
  TEST_ASSERT_FALSE(improv_link::connecting());
  network::sim_set_provision_succeeds(true);
}

void test_a_retry_after_a_failure_does_not_take_the_old_failure_for_its_result()
{
  network::sim_set_provision_succeeds(false);
  improv_link::handle_frame(3, rpc(1, wifi_args("HomeNet", "wrong-pass1")), now);
  run_ms(now, 1500);
  TEST_ASSERT_FALSE(improv_link::connecting());
  network::sim_set_provision_succeeds(true);
  frames.clear();
  improv_link::handle_frame(3, rpc(1, wifi_args("HomeNet", "correct-horse")), now);
  frames.clear();
  // The network task has not run yet: the snapshot still holds the earlier failure, with the earlier request's id
  improv_link::poll(now);
  TEST_ASSERT_TRUE(improv_link::connecting());
  TEST_ASSERT_EQUAL_size_t(0, frames.size());
  run_ms(now, 1500);
  TEST_ASSERT_EQUAL_STRING("HomeNet", settings::board().wifi_ssid);
  TEST_ASSERT_EQUAL_STRING(improv::result_packet(improv::Command::WifiSettings, {}).c_str(), frames.back().c_str());
}

void test_a_retry_after_a_success_does_not_store_unchecked_credentials()
{
  improv_link::handle_frame(3, rpc(1, wifi_args("HomeNet", "correct-horse")), now);
  run_ms(now, 1500);
  TEST_ASSERT_EQUAL_STRING("correct-horse", settings::board().wifi_password);
  network::sim_set_provision_succeeds(false);
  improv_link::handle_frame(3, rpc(1, wifi_args("Other", "another-pass1")), now);
  frames.clear();
  improv_link::poll(now); // the earlier success is still in the snapshot
  TEST_ASSERT_TRUE(improv_link::connecting());
  TEST_ASSERT_EQUAL_STRING("HomeNet", settings::board().wifi_ssid);
  run_ms(now, 1500);
  TEST_ASSERT_EQUAL_STRING("HomeNet", settings::board().wifi_ssid);
  TEST_ASSERT_EQUAL_STRING(improv::error_packet(improv::Error::UnableToConnect).c_str(), frames[0].c_str());
  network::sim_set_provision_succeeds(true);
}

void test_a_second_request_while_one_runs_is_refused()
{
  improv_link::handle_frame(3, rpc(1, wifi_args("HomeNet", "correct-horse")), now);
  run_ms(now, 50);
  frames.clear();
  improv_link::handle_frame(3, rpc(1, wifi_args("Other", "another-pass1")), now);
  // The try that runs is not touched: the refusal, and the state it is in
  TEST_ASSERT_EQUAL_STRING(improv::error_packet(improv::Error::UnableToConnect).c_str(), frames[1].c_str());
  TEST_ASSERT_EQUAL_STRING(STATE_PROVISIONING.c_str(), frames[2].c_str());
  run_ms(now, 1500);
  TEST_ASSERT_EQUAL_STRING("HomeNet", settings::board().wifi_ssid);
}

void test_a_network_that_cannot_be_saved_is_not_a_success()
{
  settings::sim_fail_key("settings");
  improv_link::handle_frame(3, rpc(1, wifi_args("HomeNet", "correct-horse")), now);
  run_ms(now, 500); // the try is running
  TEST_ASSERT_EQUAL_STRING("", network::snapshot().ssid);
  frames.clear();
  run_ms(now, 1000);
  TEST_ASSERT_FALSE(improv_link::connecting());
  TEST_ASSERT_EQUAL_STRING("", settings::board().wifi_ssid);
  TEST_ASSERT_EQUAL_size_t(2, frames.size());
  TEST_ASSERT_EQUAL_STRING(improv::error_packet(improv::Error::UnableToConnect).c_str(), frames[0].c_str());
  TEST_ASSERT_EQUAL_STRING(STATE_READY.c_str(), frames[1].c_str());
  // The radio went back to the stored network (none), not the one that was not saved, and the status never showed it
  TEST_ASSERT_EQUAL_STRING("", network::sim_applied().wifi_ssid);
  TEST_ASSERT_EQUAL_STRING("", network::snapshot().ssid);
  settings::sim_fail_key("");
}

void test_a_scan_during_a_connection_gets_the_empty_result_and_the_connection_is_kept()
{
  network::Network found[1] = {{"Near", -40, true}};
  network::sim_set_scan(found, 1);
  improv_link::handle_frame(3, rpc(1, wifi_args("HomeNet", "correct-horse")), now);
  run_ms(now, 50);
  frames.clear();
  improv_link::handle_frame(3, rpc(4), now);
  TEST_ASSERT_EQUAL_size_t(2, frames.size());
  TEST_ASSERT_EQUAL_STRING(improv::result_packet(improv::Command::ScanNetworks, {}).c_str(), frames[1].c_str());
  run_ms(now, 1500);
  TEST_ASSERT_EQUAL_STRING("HomeNet", settings::board().wifi_ssid);
  TEST_ASSERT_EQUAL_STRING("correct-horse", settings::board().wifi_password);
  TEST_ASSERT_EQUAL_STRING(improv::result_packet(improv::Command::WifiSettings, {}).c_str(), frames.back().c_str());
}

void test_a_connection_during_a_scan_is_refused_and_the_scan_goes_on()
{
  network::Network found[1] = {{"Near", -40, true}};
  network::sim_set_scan(found, 1);
  improv_link::handle_frame(3, rpc(4), now);
  frames.clear();
  improv_link::handle_frame(3, rpc(1, wifi_args("HomeNet", "correct-horse")), now);
  TEST_ASSERT_EQUAL_STRING(improv::error_packet(improv::Error::UnableToConnect).c_str(), frames[1].c_str());
  TEST_ASSERT_FALSE(improv_link::connecting());
  frames.clear();
  run_ms(now, 30);
  TEST_ASSERT_EQUAL_size_t(2, frames.size());
  TEST_ASSERT_EQUAL_STRING(improv::result_packet(improv::Command::ScanNetworks, {"Near", "-40", "YES"}).c_str(),
                           frames[0].c_str());
}

void test_improv_refuses_a_network_or_password_the_board_would_not_use()
{
  for (const std::string &args : {wifi_args("", ""), wifi_args(std::string(33, 'x'), ""), wifi_args("Net", "short"),
                                  wifi_args("Net", std::string(64, 'p')),
                                  wifi_args("a\x01"
                                            "b",
                                            ""),
                                  wifi_args("a\x7f"
                                            "b",
                                            ""),
                                  wifi_args("\xff\xfe", ""), wifi_args(std::string(31, 'a') + "\xc3\xa9", "")})
  {
    frames.clear();
    improv_link::handle_frame(3, rpc(1, args), now);
    TEST_ASSERT_EQUAL_STRING(improv::error_packet(improv::Error::InvalidRpc).c_str(), frames.back().c_str());
    TEST_ASSERT_FALSE(improv_link::connecting());
  }
}

// ---- The update flow ----

namespace
{
const char *MANIFEST_020 =
    "{\"schema\":1,\"board\":\"esp32c3\",\"version\":\"0.2.0\",\"file\":\"a.bin\",\"size\":65536,\"sha256\":"
    "\"de2f256064a0af797747c2b97505dc0b9f3df0de4f489eac731c23ae9ca9cc31\"}";

void go_online(const char *mode)
{
  net::BoardSettings board = settings::board();
  net::update_mode_from_name(mode, board.update_mode);
  TEST_ASSERT_TRUE(app::change_settings(settings::current(), board, now) == settings::Commit::Ok);
  sim_control::handle("!net state=connected ssid=HomeNet rssi=-50 ip=10.0.0.5 synced=1 epoch=1790000000", now);
  sim_control::handle("!update firmware 65536 0", now);
  update_http::sim_set_manifest(update_http::Target::Firmware, MANIFEST_020);
}
} // namespace

void test_the_sha256_of_zeros_the_cases_use_is_right()
{
  const std::vector<uint8_t> zeros(65536, 0);
  net::Sha256 hash;
  hash.update(zeros.data(), zeros.size());
  uint8_t digest[net::SHA256_SIZE];
  hash.finish(digest);
  char hex[net::SHA256_HEX + 1];
  net::to_hex(digest, hex);
  TEST_ASSERT_EQUAL_STRING("de2f256064a0af797747c2b97505dc0b9f3df0de4f489eac731c23ae9ca9cc31", hex);
}

void test_a_trial_boot_confirms_after_the_health_check_and_never_before_the_first_output()
{
  firmware::sim_set_trial(true);
  app::begin(now, 1); // restart into the image on trial: the first output is not written yet
  protocol::begin(1);
  TEST_ASSERT_TRUE(updates::status().trial);
  updates::protocol_ready();
  updates::tick(now + 1000);
  TEST_ASSERT_TRUE(updates::status().trial); // no output yet: not confirmed
  TEST_ASSERT_FALSE(firmware::sim_marked_valid());
  app::tick(now);
  updates::tick(now + 2000);
  TEST_ASSERT_FALSE(updates::status().trial);
  TEST_ASSERT_TRUE(firmware::sim_marked_valid());
}

void test_a_rollback_needs_the_evidence_that_the_pending_image_ran()
{
  // An old rollback left the other slot marked invalid. A power cut then lost the switch to the new image: the pending
  // version never ran, so it is dropped, not skipped.
  zenit::update::UpdateRecord record;
  zenit::update::set_version(record.pending, "0.3.0");
  zenit::update::set_version(record.skipped, "0.2.0");
  TEST_ASSERT_TRUE(settings::commit_update(record) == settings::Commit::Ok);
  firmware::sim_set_other_invalid(true);
  settings::begin();
  app::begin(now, 1);
  TEST_ASSERT_EQUAL_STRING("", settings::update_record().pending);
  TEST_ASSERT_EQUAL_STRING("0.2.0", settings::update_record().skipped);
  TEST_ASSERT_EQUAL_STRING("", settings::update_record().rolled_back);
  // The same record with the evidence is a rollback
  zenit::update::set_version(record.pending, "0.3.0");
  record.booted = true;
  TEST_ASSERT_TRUE(settings::commit_update(record) == settings::Commit::Ok);
  settings::begin();
  app::begin(now, 1);
  TEST_ASSERT_EQUAL_STRING("0.3.0", settings::update_record().skipped);
  TEST_ASSERT_EQUAL_STRING("0.3.0", settings::update_record().rolled_back);
  TEST_ASSERT_FALSE(settings::update_record().booted);
}

void test_the_pending_image_stores_that_it_ran_before_it_confirms()
{
  zenit::update::UpdateRecord record;
  zenit::update::set_version(record.pending, "0.1.0"); // the running version of these tests
  TEST_ASSERT_TRUE(settings::commit_update(record) == settings::Commit::Ok);
  firmware::sim_set_trial(true);
  settings::sim_fail_key("update");
  settings::begin();
  app::begin(now, 1);
  app::tick(now);
  updates::protocol_ready();
  updates::tick(1000);
  TEST_ASSERT_TRUE(updates::status().trial); // the evidence cannot be stored: not confirmed
  TEST_ASSERT_FALSE(firmware::sim_marked_valid());
  settings::sim_fail_key("");
  updates::tick(1500);
  updates::tick(4000);
  TEST_ASSERT_FALSE(updates::status().trial);
  TEST_ASSERT_TRUE(firmware::sim_marked_valid());
  TEST_ASSERT_EQUAL_STRING("", settings::update_record().pending);
  TEST_ASSERT_FALSE(settings::update_record().booted);
}

void test_a_trial_waits_for_the_protocol_too()
{
  firmware::sim_set_trial(true);
  app::begin(now, 1);
  app::tick(now);
  updates::tick(now + 1000);
  TEST_ASSERT_TRUE(updates::status().trial);
  updates::protocol_ready();
  updates::tick(now + 2000);
  TEST_ASSERT_FALSE(updates::status().trial);
}

void test_a_confirmation_that_cannot_be_marked_is_tried_again()
{
  firmware::sim_set_trial(true);
  firmware::sim_fail("mark_valid");
  app::begin(now, 1);
  app::tick(now);
  updates::protocol_ready();
  updates::tick(1000);
  TEST_ASSERT_TRUE(updates::status().trial);
  firmware::sim_fail("");
  updates::tick(1500); // inside the two seconds before the retry
  TEST_ASSERT_TRUE(updates::status().trial);
  updates::tick(4000);
  TEST_ASSERT_FALSE(updates::status().trial);
}

void test_no_install_starts_during_a_trial()
{
  go_online("notify");
  firmware::sim_set_trial(true);
  app::begin(now, 1); // restarts into an image on trial, and forgets the network
  sim_control::handle("!net state=connected ssid=HomeNet rssi=-50 ip=10.0.0.5 synced=1 epoch=1790000000", now);
  TEST_ASSERT_TRUE(updates::status().trial);
  TEST_ASSERT_TRUE(updates::request_check(now) == updates::Reply::Ok);
  network::poll(now); // the check finishes before the trial is confirmed
  TEST_ASSERT_TRUE(updates::status().last_result == zenit::update::Result::Available);
  TEST_ASSERT_TRUE(updates::status().trial);
  TEST_ASSERT_TRUE(updates::request_install(install_target::Target::Firmware, false) ==
                   updates::Reply::NothingToInstall);
  TEST_ASSERT_TRUE(updates::request_install(install_target::Target::Firmware, true) ==
                   updates::Reply::NothingToInstall);
}

void test_an_unreadable_update_record_installs_nothing()
{
  settings::sim_write_raw("update", std::vector<uint8_t>(10, 1));
  settings::begin();
  app::begin(now, 1);
  TEST_ASSERT_FALSE(settings::update_record_readable());
  go_online("notify");
  updates::request_check(now);
  run_ms(now, 20);
  TEST_ASSERT_TRUE(updates::request_install(install_target::Target::Firmware, false) ==
                   updates::Reply::NothingToInstall);
}

void test_a_pending_record_that_cannot_be_stored_aborts_the_install_before_the_slot_is_activated()
{
  go_online("notify");
  updates::request_check(now);
  run_ms(now, 20);
  settings::sim_fail_key("update");
  TEST_ASSERT_TRUE(updates::request_install(install_target::Target::Firmware, false) == updates::Reply::Ok);
  run_ms(now, 20);
  TEST_ASSERT_FALSE(firmware::sim_activated());
  TEST_ASSERT_TRUE(updates::status().last_result == zenit::update::Result::FlashError);
  TEST_ASSERT_TRUE(updates::status().state == zenit::update::State::Idle);
  TEST_ASSERT_EQUAL_STRING("", settings::update_record().pending);
}

void test_a_failed_activation_leaves_no_pending_record()
{
  go_online("notify");
  updates::request_check(now);
  run_ms(now, 20);
  firmware::sim_fail("activate");
  updates::request_install(install_target::Target::Firmware, false);
  run_ms(now, 20);
  TEST_ASSERT_TRUE(updates::status().last_result == zenit::update::Result::FlashError);
  TEST_ASSERT_EQUAL_STRING("", settings::update_record().pending);
  TEST_ASSERT_FALSE(firmware::sim_restarted());
}

void test_the_pending_version_is_stored_before_the_restart()
{
  go_online("notify");
  updates::request_check(now);
  run_ms(now, 20);
  updates::request_install(install_target::Target::Firmware, false);
  run_ms(now, 20);
  TEST_ASSERT_EQUAL_STRING("0.2.0", settings::update_record().pending);
  TEST_ASSERT_TRUE(firmware::sim_activated());
  TEST_ASSERT_FALSE(firmware::sim_restarted()); // after the delay, so the reply goes out first
}

void test_a_failed_automatic_install_waits_before_trying_again()
{
  go_online("automatic");
  updates::request_check(now);
  firmware::sim_fail("write");
  run_ms(now, 400); // the check, the install, the failure
  TEST_ASSERT_TRUE(updates::status().last_result == zenit::update::Result::FlashError);
  const size_t before = firmware::sim_written();
  firmware::sim_fail("");
  run_ms(now, 60000); // a minute: the automatic install does not repeat at once
  TEST_ASSERT_EQUAL_UINT32(before, firmware::sim_written());
  TEST_ASSERT_TRUE(updates::status().last_result == zenit::update::Result::FlashError);
}

void test_a_check_runs_by_itself_two_minutes_after_the_board_is_ready()
{
  go_online("notify");
  run_ms(now, 119000);
  TEST_ASSERT_TRUE(updates::status().last_result == zenit::update::Result::Never);
  run_ms(now, 2000);
  TEST_ASSERT_TRUE(updates::status().last_result == zenit::update::Result::Available);
}

void test_checks_stop_when_updates_are_turned_off_and_the_state_is_reported()
{
  go_online("notify");
  net::BoardSettings board = settings::board();
  board.update_firmware = false;
  app::change_settings(settings::current(), board, now);
  run_ms(now, 200000);
  TEST_ASSERT_TRUE(updates::status().last_result == zenit::update::Result::Never);
  TEST_ASSERT_EQUAL_STRING("off", updates::status().mode);
  // Web updates are still on: a check reads the web manifest alone.
  TEST_ASSERT_TRUE(updates::request_check(now) == updates::Reply::Ok);
  run_ms(now, 1000);
  TEST_ASSERT_TRUE(updates::status().last_result == zenit::update::Result::Never);
  TEST_ASSERT_TRUE(updates::status().web.last_result == zenit::update::Result::UpToDate);
  board.update_web = false;
  app::change_settings(settings::current(), board, now);
  TEST_ASSERT_TRUE(updates::request_check(now) == updates::Reply::UpdatesOff);
}

// ---- Login state of the protocol core ----

namespace
{
std::vector<std::string> written;
void collect(const char *line, size_t length) { written.emplace_back(line, length); }
} // namespace

void test_login_is_pending_only_for_a_wifi_client_of_a_board_with_the_login_on()
{
  TEST_ASSERT_FALSE(protocol::wifi_login_pending());
  net::BoardSettings board = settings::board();
  board.network_login = true;
  TEST_ASSERT_TRUE(settings::commit_board(board) == settings::Commit::Ok);
  TEST_ASSERT_TRUE(protocol::wifi_login_pending());
  protocol::wifi_opened(0);
  TEST_ASSERT_TRUE(protocol::wifi_login_pending());
  protocol::wifi_closed();
  board.network_login = false;
  settings::commit_board(board);
  TEST_ASSERT_FALSE(protocol::wifi_login_pending());
}

void test_a_close_request_is_read_once_and_cleared_by_a_new_connection()
{
  TEST_ASSERT_FALSE(protocol::take_wifi_close_request());
  // settings_reset over USB asks to close the WiFi client
  const std::string json = "{\"seq\":1,\"cmd\":\"settings_reset\"}";
  char line[256];
  const size_t size = zenit::proto::format_frame(line, sizeof(line), json.data(), json.size());
  protocol::handle_line(protocol::Transport::Usb, line, size - 1, 0, collect);
  TEST_ASSERT_TRUE(protocol::take_wifi_close_request());
  TEST_ASSERT_FALSE(protocol::take_wifi_close_request());
}

namespace
{
net::OriginScan scan_of(const std::vector<std::string> &chunks)
{
  net::OriginScan scan;
  for (const std::string &chunk : chunks)
    scan.feed(chunk.data(), chunk.size());
  return scan;
}
} // namespace

void test_the_origin_of_a_handshake_is_read_from_its_raw_bytes()
{
  const std::string request = "GET /ws HTTP/1.1\r\nHost: zenit-a1b2.local\r\norIGin:  http://zenit-a1b2.local \r\n"
                              "Upgrade: websocket\r\n\r\n\x81\x85masked";
  net::OriginScan scan = scan_of({request});
  TEST_ASSERT_TRUE(scan.done());
  TEST_ASSERT_EQUAL_STRING("http://zenit-a1b2.local", scan.origin());
  // The same bytes one at a time
  net::OriginScan bytes;
  for (char c : request)
    bytes.feed(&c, 1);
  TEST_ASSERT_TRUE(bytes.done());
  TEST_ASSERT_EQUAL_STRING("http://zenit-a1b2.local", bytes.origin());
}

void test_a_handshake_without_an_origin_is_told_apart_from_a_bad_one()
{
  net::OriginScan none = scan_of({"GET /ws HTTP/1.1\r\nHost: x\r\n\r\n"});
  TEST_ASSERT_TRUE(none.done());
  TEST_ASSERT_TRUE(none.missing());
  TEST_ASSERT_NULL(none.origin());
  // An origin on the request line is not a header
  TEST_ASSERT_TRUE(scan_of({"GET /Origin:x HTTP/1.1\r\n\r\n"}).missing());
  net::OriginScan twice = scan_of({"GET / HTTP/1.1\r\nOrigin: http://a.local\r\nOrigin: http://b.local\r\n\r\n"});
  TEST_ASSERT_FALSE(twice.missing());
  TEST_ASSERT_NULL(twice.origin());
  const std::string longest(net::OriginScan::MAX_ORIGIN, 'a');
  TEST_ASSERT_EQUAL_STRING(longest.c_str(), scan_of({"GET / HTTP/1.1\r\nOrigin: " + longest + "\r\n\r\n"}).origin());
  net::OriginScan too_long = scan_of({"GET / HTTP/1.1\r\nOrigin: " + longest + "a\r\n\r\n"});
  TEST_ASSERT_FALSE(too_long.missing());
  TEST_ASSERT_NULL(too_long.origin());
  net::OriginScan far_too_long = scan_of({"GET / HTTP/1.1\r\nOrigin: " + std::string(2000, 'a') + "\r\n\r\n"});
  TEST_ASSERT_TRUE(far_too_long.done());
  TEST_ASSERT_FALSE(far_too_long.missing());
  TEST_ASSERT_NULL(far_too_long.origin());
  // A long header of another name does not count, and nothing after the headers is read
  net::OriginScan other = scan_of({"GET / HTTP/1.1\r\nCookie: " + std::string(2000, 'c') + "\r\n\r\nOrigin: x\r\n"});
  TEST_ASSERT_TRUE(other.done());
  TEST_ASSERT_TRUE(other.missing());
  net::OriginScan partial = scan_of({"GET / HTTP/1.1\r\nOrigin: http://a.local\r\n"});
  TEST_ASSERT_FALSE(partial.done());
}

// ---- The web app in its own partition ----

namespace
{
// The image of the specification's example, built byte by byte: one file, index.html, of 5 bytes, protocols 1 to 2.
std::vector<uint8_t> spec_image()
{
  const char path[] = "index.html", type[] = "text/html; charset=utf-8", page[] = "hello";
  std::vector<uint8_t> body;
  body.push_back(10);
  body.insert(body.end(), path, path + 11); // with its NUL
  body.push_back(24);
  body.insert(body.end(), type, type + 25);
  const uint8_t place[8] = {46, 0, 0, 0, 5, 0, 0, 0}; // offset 46 (the index's size), length 5
  body.insert(body.end(), place, place + 8);
  body.insert(body.end(), page, page + 5);
  std::vector<uint8_t> image(net::WEB_HEADER_SIZE, 0);
  std::memcpy(image.data(), "ZWEB\x01\x01\x02\x00", 8);
  std::memcpy(image.data() + 8, "1.2.3", 5);
  image[24] = 1;
  image[28] = static_cast<uint8_t>(body.size());
  net::Sha256 hash;
  hash.update(body.data(), body.size());
  uint8_t digest[net::SHA256_SIZE];
  hash.finish(digest);
  std::memcpy(image.data() + 32, digest, sizeof(digest));
  image.insert(image.end(), body.begin(), body.end());
  return image;
}

// An image of `files` (path, media type, bytes) laid out as the specification says, before any mutation.
struct ImageFile
{
  std::string path, type, data;
};

std::vector<uint8_t> build_image(const std::vector<ImageFile> &files, const char *version = "1.0.0")
{
  size_t index = 0;
  for (const ImageFile &f : files)
    index += 1 + f.path.size() + 1 + 1 + f.type.size() + 1 + 8;
  std::vector<uint8_t> body;
  size_t offset = index;
  for (const ImageFile &f : files)
  {
    body.push_back(static_cast<uint8_t>(f.path.size()));
    body.insert(body.end(), f.path.begin(), f.path.end());
    body.push_back(0);
    body.push_back(static_cast<uint8_t>(f.type.size()));
    body.insert(body.end(), f.type.begin(), f.type.end());
    body.push_back(0);
    for (int i = 0; i < 4; i++)
      body.push_back(static_cast<uint8_t>(offset >> (8 * i)));
    for (int i = 0; i < 4; i++)
      body.push_back(static_cast<uint8_t>(f.data.size() >> (8 * i)));
    offset += f.data.size();
  }
  for (const ImageFile &f : files)
    body.insert(body.end(), f.data.begin(), f.data.end());
  std::vector<uint8_t> image(net::WEB_HEADER_SIZE, 0);
  std::memcpy(image.data(), "ZWEB\x01\x01\x01\x00", 8);
  std::memcpy(image.data() + 8, version, std::strlen(version));
  image[24] = static_cast<uint8_t>(files.size());
  for (int i = 0; i < 4; i++)
    image[28 + i] = static_cast<uint8_t>(body.size() >> (8 * i));
  image.insert(image.end(), body.begin(), body.end());
  return image;
}

// Writes the SHA-256 of the body into the header, so a mutation of the body is judged by the other rules.
std::vector<uint8_t> rehashed(std::vector<uint8_t> image)
{
  net::Sha256 hash;
  hash.update(image.data() + net::WEB_HEADER_SIZE, image.size() - net::WEB_HEADER_SIZE);
  uint8_t digest[net::SHA256_SIZE];
  hash.finish(digest);
  std::memcpy(image.data() + 32, digest, sizeof(digest));
  return image;
}

bool reads(const std::vector<uint8_t> &image)
{
  net::WebImageInfo info;
  net::Asset assets[net::MAX_WEB_FILES];
  size_t count = 0;
  const char *why = "";
  return net::read_web_image(image.data(), image.size(), info, assets, count, why);
}

// Flash that records the order of the writes and can lose its power after a number of operations.
class RecordingFlash : public net::WebFlash
{
public:
  std::vector<uint8_t> bytes = std::vector<uint8_t>(net::WEB_PARTITION_SIZE, 0x00);
  std::vector<uint32_t> writes;
  int power_left = -1; // operations before the power goes; -1 never
  bool erase(uint32_t offset, uint32_t size) override
  {
    if (!step())
      return false;
    std::fill(bytes.begin() + offset, bytes.begin() + offset + size, 0xFF);
    return true;
  }
  bool write(uint32_t offset, const uint8_t *data, size_t size) override
  {
    if (!step())
      return false;
    for (size_t i = 0; i < size; i++)
      TEST_ASSERT_EQUAL_HEX8(0xFF, bytes[offset + i]); // only erased flash is written
    std::memcpy(bytes.data() + offset, data, size);
    writes.push_back(offset);
    return true;
  }

private:
  bool step() { return power_left < 0 || power_left-- > 0; }
};

std::string web_manifest(const char *version, size_t size, const char *sha, int low, int high)
{
  char text[400];
  std::snprintf(text, sizeof(text),
                "{\"schema\":1,\"version\":\"%s\",\"file\":\"zenit-web.bin\",\"size\":%u,\"sha256\":\"%s\","
                "\"protocol_min\":%d,\"protocol_max\":%d}",
                version, static_cast<unsigned>(size), sha, low, high);
  return text;
}

// Publishes a web image of `version` that speaks `low` to `high`, with its manifest.
void publish_web(const char *version, int low, int high)
{
  uint8_t *data;
  size_t size;
  www::sim_make_image(version, static_cast<uint8_t>(low), static_cast<uint8_t>(high), data, size);
  update_http::sim_set_file(update_http::Target::Web, data, size);
  net::Sha256 hash;
  hash.update(data, size);
  uint8_t digest[net::SHA256_SIZE];
  hash.finish(digest);
  char hex[net::SHA256_HEX + 1];
  net::to_hex(digest, hex);
  update_http::sim_set_manifest(update_http::Target::Web, web_manifest(version, size, hex, low, high).c_str());
}

void online_with_web(const char *mode)
{
  net::BoardSettings board = settings::board();
  net::update_mode_from_name(mode, board.update_mode);
  board.update_firmware = false;
  TEST_ASSERT_TRUE(app::change_settings(settings::current(), board, now) == settings::Commit::Ok);
  sim_control::handle("!net state=connected ssid=HomeNet rssi=-50 ip=10.0.0.5 synced=1 epoch=1790000000", now);
}
} // namespace

void test_the_image_of_the_specification_reads_with_its_files()
{
  const std::vector<uint8_t> image = spec_image();
  net::WebImageInfo info;
  net::Asset assets[net::MAX_WEB_FILES];
  size_t count = 0;
  const char *why = "";
  TEST_ASSERT_TRUE_MESSAGE(net::read_web_image(image.data(), image.size(), info, assets, count, why), why);
  TEST_ASSERT_EQUAL_STRING("1.2.3", info.version);
  TEST_ASSERT_EQUAL_UINT8(1, info.protocol_min);
  TEST_ASSERT_EQUAL_UINT8(2, info.protocol_max);
  TEST_ASSERT_EQUAL_size_t(1, count);
  TEST_ASSERT_EQUAL_STRING("index.html", assets[0].path);
  TEST_ASSERT_EQUAL_STRING("text/html; charset=utf-8", assets[0].content_type);
  TEST_ASSERT_EQUAL_size_t(5, assets[0].size);
  TEST_ASSERT_EQUAL_MEMORY("hello", assets[0].data, 5);
  TEST_ASSERT_FALSE(assets[0].immutable);
}

void test_an_image_that_breaks_a_rule_does_not_read()
{
  struct Change
  {
    size_t at;
    uint8_t value;
  };
  const size_t body = net::WEB_HEADER_SIZE;
  const Change changes[] = {
      {0, 'X'},         // magic
      {4, 2},           // format
      {5, 0},           // protocol_min 0
      {5, 3},           // protocol_min above protocol_max
      {7, 1},           // reserved
      {8, 'v'},         // version not digits
      {24, 0},          // no file
      {24, 65},         // too many files
      {26, 1},          // reserved
      {100, 1},         // not zero after the fields
      {body + 46, 'j'}, // a byte of the body: the SHA-256 no longer matches
  };
  TEST_ASSERT_TRUE(reads(spec_image()));
  for (const Change &change : changes)
  {
    std::vector<uint8_t> image = spec_image();
    image[change.at] = change.value;
    TEST_ASSERT_FALSE_MESSAGE(reads(image), std::to_string(change.at).c_str());
  }
  std::vector<uint8_t> cut = spec_image();
  cut.resize(cut.size() - 1);
  TEST_ASSERT_FALSE(reads(cut));
  // An index that points a file outside the body, with the hash made to match
  std::vector<uint8_t> outside = spec_image();
  outside[body + 42] = 6; // length 6 of a 51-byte body that starts the file at 46
  net::Sha256 hash;
  hash.update(outside.data() + body, outside.size() - body);
  uint8_t digest[net::SHA256_SIZE];
  hash.finish(digest);
  std::memcpy(outside.data() + 32, digest, sizeof(digest));
  TEST_ASSERT_FALSE(reads(outside));
}

void test_the_writer_writes_the_header_last()
{
  const std::vector<uint8_t> image = spec_image();
  RecordingFlash flash;
  net::WebWriter writer;
  TEST_ASSERT_TRUE(writer.begin(flash, static_cast<uint32_t>(image.size()), "1.2.3", 1));
  for (size_t at = 0; at < image.size(); at += 1000)
    TEST_ASSERT_TRUE(writer.write(image.data() + at, std::min<size_t>(1000, image.size() - at)));
  TEST_ASSERT_FALSE(flash.writes.empty());
  for (uint32_t offset : flash.writes)
    TEST_ASSERT_TRUE(offset >= net::WEB_HEADER_SIZE); // nothing of the header before finish
  TEST_ASSERT_FALSE(reads(flash.bytes));
  TEST_ASSERT_TRUE(writer.finish());
  TEST_ASSERT_EQUAL_UINT32(0, flash.writes.back());
  TEST_ASSERT_TRUE(reads(flash.bytes));
}

void test_a_power_cut_at_any_step_of_an_install_leaves_no_image()
{
  const std::vector<uint8_t> old_image = spec_image();
  // The operations: the erase of the old header with the body's sector, the body, the header. Power lost before the
  // first: the old image is untouched. Lost at any later step: no image.
  for (int power = 0; power < 3; power++)
  {
    RecordingFlash flash;
    std::copy(old_image.begin(), old_image.end(), flash.bytes.begin());
    TEST_ASSERT_TRUE(reads(flash.bytes));
    flash.power_left = power; // header erase, body erase, body write, header write
    net::WebWriter writer;
    const bool ok = writer.begin(flash, static_cast<uint32_t>(old_image.size()), "1.2.3", 1) &&
                    writer.write(old_image.data(), old_image.size()) && writer.finish();
    TEST_ASSERT_FALSE(ok);
    TEST_ASSERT_TRUE_MESSAGE(reads(flash.bytes) == (power == 0), std::to_string(power).c_str());
  }
}

void test_the_writer_refuses_more_bytes_than_announced_and_a_short_image()
{
  RecordingFlash flash;
  net::WebWriter writer;
  TEST_ASSERT_FALSE(writer.begin(flash, net::WEB_HEADER_SIZE, "1.2.3", 1));        // a header and no body
  TEST_ASSERT_FALSE(writer.begin(flash, net::WEB_PARTITION_SIZE + 1, "1.2.3", 1)); // larger than the partition
  const std::vector<uint8_t> image = spec_image();
  TEST_ASSERT_TRUE(writer.begin(flash, static_cast<uint32_t>(image.size()) - 1, "1.2.3", 1));
  TEST_ASSERT_FALSE(writer.write(image.data(), image.size()));
  TEST_ASSERT_FALSE(writer.finish());
  TEST_ASSERT_TRUE(writer.begin(flash, static_cast<uint32_t>(image.size()), "1.2.3", 1));
  TEST_ASSERT_TRUE(writer.write(image.data(), image.size() - 1));
  TEST_ASSERT_FALSE(writer.finish()); // a byte is missing
}

void test_the_web_manifest_rules()
{
  const char *sha = "de2f256064a0af797747c2b97505dc0b9f3df0de4f489eac731c23ae9ca9cc31";
  zenit::update::Manifest m;
  const char *why = "";
  const std::string good = web_manifest("1.3.0", 171520, sha, 1, 2);
  TEST_ASSERT_TRUE_MESSAGE(zenit::update::parse_web_manifest(good.c_str(), good.size(), m, why), why);
  TEST_ASSERT_EQUAL_STRING("1.3.0", m.version);
  TEST_ASSERT_EQUAL_UINT32(171520, m.size);
  TEST_ASSERT_EQUAL_UINT8(1, m.protocol_min);
  TEST_ASSERT_EQUAL_UINT8(2, m.protocol_max);
  const std::string bad[] = {
      web_manifest("1.3.0", 4096, sha, 1, 1),   // a header and no body
      web_manifest("1.3.0", 524289, sha, 1, 1), // larger than the partition
      web_manifest("1.3.0", 5000, sha, 0, 1),   // protocol 0
      web_manifest("1.3.0", 5000, sha, 2, 1),   // min above max
      web_manifest("1.3.0", 5000, sha, 1, 256), // above 255
      web_manifest("1.3", 5000, sha, 1, 1),     // not X.Y.Z
      // A firmware manifest is not a web one: it has `board` and no range
      "{\"schema\":1,\"board\":\"esp32c3\",\"version\":\"0.2.0\",\"file\":\"a.bin\",\"size\":65536,\"sha256\":\"" +
          std::string(sha) + "\"}",
  };
  for (const std::string &text : bad)
    TEST_ASSERT_FALSE_MESSAGE(zenit::update::parse_web_manifest(text.c_str(), text.size(), m, why), text.c_str());
  TEST_ASSERT_EQUAL_UINT32(4097, net::MIN_WEB_IMAGE);
}

void test_the_repair_waits_double_from_one_minute_to_an_hour_with_a_fifth_either_way()
{
  TEST_ASSERT_EQUAL_UINT32(0, zenit::update::repair_wait_ms(0, 500));
  TEST_ASSERT_EQUAL_UINT32(60000, zenit::update::repair_wait_ms(1, 500));
  TEST_ASSERT_EQUAL_UINT32(120000, zenit::update::repair_wait_ms(2, 500));
  TEST_ASSERT_EQUAL_UINT32(240000, zenit::update::repair_wait_ms(3, 500));
  TEST_ASSERT_EQUAL_UINT32(1920000, zenit::update::repair_wait_ms(6, 500));
  TEST_ASSERT_EQUAL_UINT32(3600000, zenit::update::repair_wait_ms(7, 500)); // 64 minutes, held to 60
  TEST_ASSERT_EQUAL_UINT32(3600000, zenit::update::repair_wait_ms(1000, 500));
  TEST_ASSERT_EQUAL_UINT32(48000, zenit::update::repair_wait_ms(1, 0));    // 80 %
  TEST_ASSERT_EQUAL_UINT32(72000, zenit::update::repair_wait_ms(1, 1000)); // 120 %
}

void test_a_record_without_the_web_setting_reads_with_web_updates_on()
{
  net::BoardSettings s;
  uint8_t record[net::BOARD_RECORD_SIZE];
  net::encode_board_record(s, record);
  TEST_ASSERT_EQUAL_UINT8(1, record[3]); // firmware on, web on
  s.update_web = false;
  net::encode_board_record(s, record);
  TEST_ASSERT_EQUAL_UINT8(3, record[3]);
  net::BoardSettings back;
  TEST_ASSERT_TRUE(net::decode_board_record(record, sizeof(record), back));
  TEST_ASSERT_FALSE(back.update_web);
  TEST_ASSERT_TRUE(back.update_firmware);
  record[3] = 0; // firmware off, as a record written before the web setting
  TEST_ASSERT_TRUE(net::decode_board_record(record, sizeof(record), back));
  TEST_ASSERT_TRUE(back.update_web);
  TEST_ASSERT_FALSE(back.update_firmware);
  record[3] = 4; // not a value: both stay at their defaults
  TEST_ASSERT_TRUE(net::decode_board_record(record, sizeof(record), back));
  TEST_ASSERT_TRUE(back.update_web && back.update_firmware);
}

void test_the_emergency_page_says_what_happens_and_escapes_the_site()
{
  char page[net::MAX_EMERGENCY_PAGE];
  TEST_ASSERT_TRUE(net::emergency_page(true, "https://example.org/", page, sizeof(page)) > 0);
  TEST_ASSERT_NOT_NULL(std::strstr(page, "being installed"));
  TEST_ASSERT_NOT_NULL(std::strstr(page, "http-equiv=\"refresh\" content=\"30\""));
  TEST_ASSERT_NULL(std::strstr(page, "<script"));
  TEST_ASSERT_TRUE(net::emergency_page(false, "https://example.org/?a=<b>&c=\"d\"", page, sizeof(page)) > 0);
  TEST_ASSERT_NOT_NULL(std::strstr(page, "over USB: https://example.org/?a=&lt;b&gt;&amp;c=&quot;d&quot;</p>"));
  TEST_ASSERT_EQUAL_size_t(0, net::emergency_page(true, "", page, 100)); // does not fit
}

void test_a_missing_web_app_is_installed_at_once_then_retried_with_longer_waits()
{
  www::sim_erase();
  publish_web("1.1.0", 1, 1);
  update_http::sim_set_download_outcome(update_http::Target::Web, update_http::Outcome::Unreachable);
  online_with_web("notify"); // repair ignores notify
  run_ms(now, 1000);
  updates::Status s = updates::status();
  TEST_ASSERT_TRUE(s.web.state == zenit::update::WebState::Missing);
  TEST_ASSERT_TRUE(s.web.last_result == zenit::update::Result::Unreachable);
  TEST_ASSERT_TRUE(s.web.retry_in >= 48 && s.web.retry_in <= 72); // the first wait, a minute give or take a fifth
  update_http::sim_set_download_outcome(update_http::Target::Web, update_http::Outcome::Ok);
  run_ms(now, 73000);
  s = updates::status();
  TEST_ASSERT_TRUE(s.web.state == zenit::update::WebState::Ok);
  TEST_ASSERT_EQUAL_STRING("1.1.0", s.web.version);
  TEST_ASSERT_TRUE(s.web.last_result == zenit::update::Result::Installed);
  TEST_ASSERT_EQUAL_INT64(-1, s.web.retry_in);
}

void test_an_incompatible_web_app_is_reported_and_not_installed()
{
  publish_web("2.0.0", 2, 2);
  online_with_web("automatic");
  updates::request_check(now);
  run_ms(now, 1000);
  const updates::Status s = updates::status();
  TEST_ASSERT_TRUE(s.web.last_result == zenit::update::Result::Incompatible);
  TEST_ASSERT_EQUAL_STRING("", s.web.available);
  TEST_ASSERT_EQUAL_STRING("1.0.0", s.web.version);
}

void test_a_web_update_installs_in_the_window_without_a_restart()
{
  publish_web("1.2.0", 1, 2);
  online_with_web("automatic");
  updates::request_check(now);
  run_ms(now, 1000);
  const updates::Status s = updates::status();
  TEST_ASSERT_EQUAL_STRING("1.2.0", s.web.version);
  TEST_ASSERT_TRUE(s.web.state == zenit::update::WebState::Ok);
  TEST_ASSERT_FALSE(firmware::sim_restarted());
}

void test_web_updates_off_leave_a_missing_app_alone()
{
  www::sim_erase();
  publish_web("1.1.0", 1, 1);
  online_with_web("automatic");
  net::BoardSettings board = settings::board();
  board.update_web = false;
  TEST_ASSERT_TRUE(app::change_settings(settings::current(), board, now) == settings::Commit::Ok);
  run_ms(now, 200000);
  const updates::Status s = updates::status();
  TEST_ASSERT_TRUE(s.web.state == zenit::update::WebState::Missing);
  TEST_ASSERT_TRUE(s.web.last_result == zenit::update::Result::Never);
  TEST_ASSERT_FALSE(updates::web_repairable());
}

void test_a_failed_web_write_leaves_the_app_missing()
{
  publish_web("1.2.0", 1, 1);
  www::sim_fail("write");
  online_with_web("automatic");
  updates::request_check(now);
  run_ms(now, 1000);
  updates::Status s = updates::status();
  TEST_ASSERT_TRUE(s.web.state == zenit::update::WebState::Missing);
  TEST_ASSERT_TRUE(s.web.last_result == zenit::update::Result::FlashError);
  www::sim_fail("");
  run_ms(now, 73000); // the repair
  s = updates::status();
  TEST_ASSERT_TRUE(s.web.state == zenit::update::WebState::Ok);
}

void test_every_index_rule_refuses_an_image_with_a_matching_hash()
{
  const std::string html = "text/html; charset=utf-8";
  TEST_ASSERT_TRUE(reads(rehashed(build_image({{"index.html", html, "a"}, {"assets/b.js", "text/javascript", "b"}}))));
  const std::vector<std::vector<ImageFile>> refused = {
      {{"index.html", html, "a"}, {"index.html", html, "b"}}, // a path named twice
      {{"app.html", html, "a"}},                              // no index.html
      {{"index.html", html, "a"}, {"../x.js", "text/javascript", "b"}},
      {{"index.html", html, "a"}, {"/x.js", "text/javascript", "b"}},
      {{"index.html", html, "a"}, {"a\\b.js", "text/javascript", "b"}},
      {{"index.html", html, "a"}, {"a b.js", "text/javascript", "b"}},
      {{"index.html", html, "a"}, {"x.js", "", "b"}},                               // an empty media type
      {{"index.html", html, "a"}, {"x.js", std::string(64, 't'), "b"}},             // a media type of 64 characters
      {{"index.html", html, "a"}, {std::string(128, 'p'), "text/javascript", "b"}}, // a path of 128 characters
  };
  for (size_t i = 0; i < refused.size(); i++)
    TEST_ASSERT_FALSE_MESSAGE(reads(rehashed(build_image(refused[i]))), std::to_string(i).c_str());
  // The longest path and media type the specification allows
  TEST_ASSERT_TRUE(
      reads(rehashed(build_image({{"index.html", html, "a"}, {std::string(127, 'p'), std::string(63, 't'), "b"}}))));

  const size_t body = net::WEB_HEADER_SIZE;
  std::vector<uint8_t> image = build_image({{"index.html", html, "abc"}});
  // index.html: 1 + 10 + 1 + 1 + 24 + 1 + 8 = 46 bytes of index, the file from offset 46
  std::vector<uint8_t> overlap = image;
  overlap[body + 38] = 40; // the file starts inside the index
  TEST_ASSERT_FALSE(reads(rehashed(overlap)));
  std::vector<uint8_t> nul = image;
  nul[body + 3] = 0; // a NUL inside the path
  TEST_ASSERT_FALSE(reads(rehashed(nul)));
  std::vector<uint8_t> unterminated = image;
  unterminated[body + 11] = 'x'; // no NUL after the path
  TEST_ASSERT_FALSE(reads(rehashed(unterminated)));
  std::vector<uint8_t> control = image;
  control[body + 14] = 0x07; // a control byte in the media type
  TEST_ASSERT_FALSE(reads(rehashed(control)));
  std::vector<uint8_t> short_index = image;
  short_index[24] = 2; // two files announced, one in the index
  TEST_ASSERT_FALSE(reads(rehashed(short_index)));
  std::vector<uint8_t> padded = image;
  padded[8 + 7] = '1'; // a byte after the version's zero padding began
  TEST_ASSERT_FALSE(reads(rehashed(padded)));
  std::vector<uint8_t> empty_body = image;
  std::memset(empty_body.data() + 28, 0, 4);
  TEST_ASSERT_FALSE(reads(empty_body));
  std::vector<uint8_t> huge_body = image;
  huge_body[28] = 0x01;
  huge_body[29] = 0xF0;
  huge_body[30] = 0x07; // 0x7F001, one byte more than the partition holds after the header
  TEST_ASSERT_FALSE(reads(huge_body));
}

void test_a_power_cut_at_any_step_of_a_long_install_leaves_no_image()
{
  // Three sectors of files, so the writer erases and writes more than once, in chunks across sector ends.
  const std::vector<uint8_t> image = rehashed(build_image(
      {{"index.html", "text/html", std::string(5000, 'i')}, {"a.js", "text/javascript", std::string(7000, 'a')}}));
  TEST_ASSERT_TRUE(reads(image));
  int steps = 0;
  for (int power = 0;; power++)
  {
    RecordingFlash flash;
    std::copy(image.begin(), image.end(), flash.bytes.begin());
    flash.power_left = power;
    net::WebWriter writer;
    bool ok = writer.begin(flash, static_cast<uint32_t>(image.size()), "1.0.0", 1);
    for (size_t at = 0; ok && at < image.size(); at += 1500)
      ok = writer.write(image.data() + at, std::min<size_t>(1500, image.size() - at));
    ok = ok && writer.finish();
    if (ok)
    {
      TEST_ASSERT_TRUE(reads(flash.bytes));
      steps = power;
      break;
    }
    TEST_ASSERT_TRUE_MESSAGE(reads(flash.bytes) == (power == 0), std::to_string(power).c_str());
    TEST_ASSERT_TRUE(power < 100);
  }
  TEST_ASSERT_TRUE(steps > 6); // several erases and writes were cut
}

void test_an_incompatible_app_is_replaced_by_an_older_compatible_one()
{
  sim_control::handle("!www load 2.0.0 2 2", now);
  TEST_ASSERT_TRUE(www::state() == zenit::update::WebState::Incompatible);
  publish_web("1.9.0", 1, 1);
  online_with_web("notify");
  run_ms(now, 1000);
  const updates::Status s = updates::status();
  TEST_ASSERT_TRUE(s.web.state == zenit::update::WebState::Ok);
  TEST_ASSERT_EQUAL_STRING("1.9.0", s.web.version);
}

void test_a_missing_app_is_repaired_while_the_update_record_cannot_be_stored()
{
  settings::sim_write_raw("update", {9, 9, 9});
  settings::sim_fail_key("update");
  settings::begin();
  app::begin(now, 1);
  updates::protocol_ready();
  TEST_ASSERT_FALSE(settings::update_record_readable());
  www::sim_erase();
  publish_web("1.1.0", 1, 1);
  online_with_web("automatic");
  run_ms(now, 1000);
  TEST_ASSERT_TRUE(updates::status().web.state == zenit::update::WebState::Ok);
  TEST_ASSERT_EQUAL_STRING("1.1.0", updates::status().web.version);
}

void test_a_manual_check_reads_the_firmware_manifest_while_the_record_is_not_settled()
{
  settings::sim_write_raw("update", {9, 9, 9});
  settings::sim_fail_key("update");
  settings::begin();
  app::begin(now, 1);
  updates::protocol_ready();
  go_online("notify");
  net::BoardSettings board = settings::board();
  board.update_web = false;
  TEST_ASSERT_TRUE(app::change_settings(settings::current(), board, now) == settings::Commit::Ok);
  TEST_ASSERT_TRUE(updates::request_check(now) == updates::Reply::Ok);
  run_ms(now, 1000);
  TEST_ASSERT_TRUE(updates::status().last_result == zenit::update::Result::Available);
  // and nothing is installed while the record cannot be stored
  TEST_ASSERT_TRUE(updates::request_install(install_target::Target::Firmware, false) ==
                   updates::Reply::NothingToInstall);
}

void test_a_header_that_is_not_the_offer_leaves_the_old_image_untouched()
{
  const std::vector<uint8_t> old_image = spec_image(); // 1.2.3, protocols 1 to 2
  struct Offer
  {
    const char *version;
    uint8_t protocol;
  };
  // Another version than offered; a protocol the image does not speak
  const Offer offers[] = {{"1.2.4", 1}, {"1.2.3", 3}};
  for (const Offer &offer : offers)
  {
    RecordingFlash flash;
    std::copy(old_image.begin(), old_image.end(), flash.bytes.begin());
    net::WebWriter writer;
    TEST_ASSERT_TRUE(writer.begin(flash, static_cast<uint32_t>(old_image.size()), offer.version, offer.protocol));
    TEST_ASSERT_FALSE(writer.write(old_image.data(), old_image.size()));
    TEST_ASSERT_TRUE(writer.refused());
    TEST_ASSERT_TRUE(flash.writes.empty());
    TEST_ASSERT_TRUE(reads(flash.bytes)); // nothing was erased
  }
}

void test_a_web_image_whose_header_is_not_the_offer_keeps_the_app()
{
  // The manifest offers 1.5.0 for protocol 1, the file is an image of 1.5.0 for protocol 2 only.
  uint8_t *data;
  size_t size;
  www::sim_make_image("1.5.0", 2, 2, data, size);
  update_http::sim_set_file(update_http::Target::Web, data, size);
  net::Sha256 hash;
  hash.update(data, size);
  uint8_t digest[net::SHA256_SIZE];
  hash.finish(digest);
  char hex[net::SHA256_HEX + 1];
  net::to_hex(digest, hex);
  update_http::sim_set_manifest(update_http::Target::Web, web_manifest("1.5.0", size, hex, 1, 1).c_str());
  online_with_web("automatic");
  updates::request_check(now);
  run_ms(now, 1000);
  const updates::Status s = updates::status();
  TEST_ASSERT_TRUE(s.web.state == zenit::update::WebState::Ok);
  TEST_ASSERT_EQUAL_STRING("1.0.0", s.web.version);
  TEST_ASSERT_TRUE(s.web.last_result == zenit::update::Result::BadDownload);
  TEST_ASSERT_EQUAL_STRING("", s.web.available);
}

void test_an_image_version_must_be_a_release()
{
  const char *bad[] = {"1..2", "1.", "1.2", "01.2.3", "1.2.3.4", "1.2.x", "1000000.0.0"};
  for (const char *version : bad)
  {
    std::vector<uint8_t> image = spec_image();
    std::memset(image.data() + 8, 0, 16);
    std::memcpy(image.data() + 8, version, std::strlen(version));
    TEST_ASSERT_FALSE_MESSAGE(reads(image), version);
  }
}

void test_while_a_repair_is_needed_its_waits_alone_pace_the_checks()
{
  www::sim_erase();
  update_http::sim_set_manifest_outcome(update_http::Target::Web, update_http::Outcome::Unreachable);
  online_with_web("automatic");
  // The repair's waits: about 1, 2, 4, 8, 16, 32, 60 and 60 minutes, so in 4 hours at most 10 checks, each varied by a
  // fifth. The ordinary checks after a failure (every 30 minutes) would add more.
  run_ms(now, 4ull * 60 * 60 * 1000);
  const size_t reads = update_http::sim_manifest_reads(update_http::Target::Web);
  TEST_ASSERT_TRUE_MESSAGE(reads >= 7 && reads <= 10, std::to_string(reads).c_str());
  TEST_ASSERT_TRUE(updates::status().web.retry_in > 0);
}

void test_the_status_reports_no_web_version_while_installing()
{
  TEST_ASSERT_TRUE(www::begin_install(5000, "1.1.0"));
  updates::Status s = updates::status();
  TEST_ASSERT_TRUE(s.web.state == zenit::update::WebState::Installing);
  TEST_ASSERT_EQUAL_STRING("", s.web.version);
  www::abort_install(); // nothing was written: the old image is back
  s = updates::status();
  TEST_ASSERT_TRUE(s.web.state == zenit::update::WebState::Ok);
  TEST_ASSERT_EQUAL_STRING("1.0.0", s.web.version);
}

int main()
{
  UNITY_BEGIN();
  RUN_TEST(test_the_token_is_made_once_and_kept_across_starts);
  RUN_TEST(test_board_settings_survive_a_restart);
  RUN_TEST(test_a_damaged_board_record_gives_defaults_and_a_new_token);
  RUN_TEST(test_a_commit_of_both_records_is_all_or_nothing);
  RUN_TEST(test_a_light_only_or_board_only_commit_keeps_the_other_record);
  RUN_TEST(test_the_records_of_a_board_from_before_the_blob_are_read_and_replaced);
  RUN_TEST(test_a_blob_of_the_wrong_size_gives_the_defaults_and_a_new_token);
  RUN_TEST(test_nothing_is_written_when_no_setting_differs);
  RUN_TEST(test_improv_reports_its_state_and_device_info);
  RUN_TEST(test_improv_says_ready_while_the_board_reconnects_by_itself_and_provisioning_only_while_it_runs);
  RUN_TEST(test_improv_refuses_bad_frames_and_commands);
  RUN_TEST(test_improv_scan_sorts_dedupes_and_ends_with_an_empty_result);
  RUN_TEST(test_a_scan_drops_the_names_that_cannot_be_reported);
  RUN_TEST(test_the_origin_of_a_handshake_is_read_from_its_raw_bytes);
  RUN_TEST(test_a_handshake_without_an_origin_is_told_apart_from_a_bad_one);
  RUN_TEST(test_a_scan_of_many_access_points_keeps_the_strongest_names_as_the_board_does);
  RUN_TEST(test_improv_stores_the_network_only_after_it_connected_and_blinks_meanwhile);
  RUN_TEST(test_improv_does_not_store_a_network_that_failed);
  RUN_TEST(test_a_retry_after_a_failure_does_not_take_the_old_failure_for_its_result);
  RUN_TEST(test_a_retry_after_a_success_does_not_store_unchecked_credentials);
  RUN_TEST(test_a_second_request_while_one_runs_is_refused);
  RUN_TEST(test_a_network_that_cannot_be_saved_is_not_a_success);
  RUN_TEST(test_a_scan_during_a_connection_gets_the_empty_result_and_the_connection_is_kept);
  RUN_TEST(test_a_connection_during_a_scan_is_refused_and_the_scan_goes_on);
  RUN_TEST(test_improv_refuses_a_network_or_password_the_board_would_not_use);
  RUN_TEST(test_the_sha256_of_zeros_the_cases_use_is_right);
  RUN_TEST(test_a_trial_boot_confirms_after_the_health_check_and_never_before_the_first_output);
  RUN_TEST(test_a_rollback_needs_the_evidence_that_the_pending_image_ran);
  RUN_TEST(test_the_pending_image_stores_that_it_ran_before_it_confirms);
  RUN_TEST(test_a_trial_waits_for_the_protocol_too);
  RUN_TEST(test_a_confirmation_that_cannot_be_marked_is_tried_again);
  RUN_TEST(test_no_install_starts_during_a_trial);
  RUN_TEST(test_an_unreadable_update_record_installs_nothing);
  RUN_TEST(test_a_pending_record_that_cannot_be_stored_aborts_the_install_before_the_slot_is_activated);
  RUN_TEST(test_a_failed_activation_leaves_no_pending_record);
  RUN_TEST(test_the_pending_version_is_stored_before_the_restart);
  RUN_TEST(test_a_failed_automatic_install_waits_before_trying_again);
  RUN_TEST(test_a_check_runs_by_itself_two_minutes_after_the_board_is_ready);
  RUN_TEST(test_checks_stop_when_updates_are_turned_off_and_the_state_is_reported);
  RUN_TEST(test_login_is_pending_only_for_a_wifi_client_of_a_board_with_the_login_on);
  RUN_TEST(test_a_close_request_is_read_once_and_cleared_by_a_new_connection);
  RUN_TEST(test_the_image_of_the_specification_reads_with_its_files);
  RUN_TEST(test_an_image_that_breaks_a_rule_does_not_read);
  RUN_TEST(test_the_writer_writes_the_header_last);
  RUN_TEST(test_a_power_cut_at_any_step_of_an_install_leaves_no_image);
  RUN_TEST(test_the_writer_refuses_more_bytes_than_announced_and_a_short_image);
  RUN_TEST(test_the_web_manifest_rules);
  RUN_TEST(test_the_repair_waits_double_from_one_minute_to_an_hour_with_a_fifth_either_way);
  RUN_TEST(test_a_record_without_the_web_setting_reads_with_web_updates_on);
  RUN_TEST(test_the_emergency_page_says_what_happens_and_escapes_the_site);
  RUN_TEST(test_a_missing_web_app_is_installed_at_once_then_retried_with_longer_waits);
  RUN_TEST(test_an_incompatible_web_app_is_reported_and_not_installed);
  RUN_TEST(test_a_web_update_installs_in_the_window_without_a_restart);
  RUN_TEST(test_web_updates_off_leave_a_missing_app_alone);
  RUN_TEST(test_a_failed_web_write_leaves_the_app_missing);
  RUN_TEST(test_every_index_rule_refuses_an_image_with_a_matching_hash);
  RUN_TEST(test_a_power_cut_at_any_step_of_a_long_install_leaves_no_image);
  RUN_TEST(test_an_incompatible_app_is_replaced_by_an_older_compatible_one);
  RUN_TEST(test_a_missing_app_is_repaired_while_the_update_record_cannot_be_stored);
  RUN_TEST(test_a_manual_check_reads_the_firmware_manifest_while_the_record_is_not_settled);
  RUN_TEST(test_a_header_that_is_not_the_offer_leaves_the_old_image_untouched);
  RUN_TEST(test_a_web_image_whose_header_is_not_the_offer_keeps_the_app);
  RUN_TEST(test_an_image_version_must_be_a_release);
  RUN_TEST(test_while_a_repair_is_needed_its_waits_alone_pace_the_checks);
  RUN_TEST(test_the_status_reports_no_web_version_while_installing);
  return UNITY_END();
}
