// SPDX-License-Identifier: GPL-3.0-or-later

#include "net_cases.h"

#include <unity.h>

#include <cstdint>

#include <ArduinoJson.h>
#include <board_settings.h>
#include <improv_frame.h>
#include <manifest.h>
#include <net_auth.h>
#include <net_http.h>
#include <net_origin.h>
#include <scan_list.h>
#include <schedule.h>
#include <semver.h>
#include <sha256.h>
#include <update_record.h>
#include <update_status.h>
#include <web_image.h>
#include <wifi_logic.h>
#include <ws_message.h>

#include <cstring>
#include <string>
#include <vector>

#include "settings.h"
#include "zenit_test.h"

namespace
{
namespace net = zenit::net;
namespace update = zenit::update;

JsonDocument load(const char *path)
{
  JsonDocument doc;
  const std::string full = zenit_test::PROJECT_DIR + "/conformance/" + path;
  DeserializationError error = deserializeJson(doc, zenit_test::read_file(full));
  TEST_ASSERT_FALSE_MESSAGE(error, (full + ": " + error.c_str()).c_str());
  return doc;
}

std::vector<uint8_t> unhex(const char *text)
{
  std::vector<uint8_t> out;
  for (size_t i = 0; text[i] && text[i + 1]; i += 2)
    out.push_back(static_cast<uint8_t>(std::stoi(std::string(text + i, 2), nullptr, 16)));
  return out;
}

std::string hex_of(const uint8_t *bytes, size_t size)
{
  static const char DIGITS[] = "0123456789abcdef";
  std::string out;
  for (size_t i = 0; i < size; i++)
  {
    out += DIGITS[bytes[i] >> 4];
    out += DIGITS[bytes[i] & 15];
  }
  return out;
}

std::string hex_of(const std::string &s) { return hex_of(reinterpret_cast<const uint8_t *>(s.data()), s.size()); }

std::string label(const char *what, size_t index) { return std::string(what) + " " + std::to_string(index); }

// Copies a JSON text into a fixed array, for the structs that hold their texts so.
template <size_t N> void copy(char (&out)[N], JsonVariantConst value)
{
  const char *text = value.as<const char *>();
  std::snprintf(out, N, "%s", text ? text : "");
}
} // namespace

void test_hash_cases()
{
  JsonDocument doc = load("net/hash.json");
  size_t index = 0;
  for (JsonObjectConst c : doc["sha256"].as<JsonArrayConst>())
  {
    const std::vector<uint8_t> input = unhex(c["hex_in"].as<const char *>());
    net::Sha256 hash;
    // Fed in uneven pieces, so the block boundaries are crossed in every way.
    size_t at = 0, piece = 1;
    while (at < input.size())
    {
      const size_t take = std::min(piece, input.size() - at);
      hash.update(input.data() + at, take);
      at += take;
      piece = piece * 3 + 1;
    }
    uint8_t digest[net::SHA256_SIZE];
    TEST_ASSERT_TRUE(hash.finish(digest));
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["digest"].as<const char *>(), hex_of(digest, sizeof(digest)).c_str(),
                                     label("sha256", index++).c_str());
  }
  index = 0;
  for (JsonObjectConst c : doc["hmac"].as<JsonArrayConst>())
  {
    const std::vector<uint8_t> key = unhex(c["key_hex"].as<const char *>());
    const std::vector<uint8_t> message = unhex(c["message_hex"].as<const char *>());
    char out[net::SHA256_HEX + 1];
    TEST_ASSERT_TRUE(net::hmac_sha256_hex(key.data(), key.size(), message.data(), message.size(), out));
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["digest"].as<const char *>(), out, label("hmac", index++).c_str());
  }
}

void test_origin_cases()
{
  JsonDocument doc = load("net/origin.json");
  const char *site = doc["site_origin"].as<const char *>();
  size_t index = 0;
  for (JsonObjectConst c : doc["site_origin_of"].as<JsonArrayConst>())
  {
    // The buffer of the board: the longest site address the build accepts, and a NUL
    char out[zenit::update::MAX_SITE_URL + 1];
    const bool ok = net::site_origin_of(c["url"].as<const char *>(), out, sizeof(out));
    const std::string name = label("site origin", index++);
    TEST_ASSERT_EQUAL_MESSAGE(!c["origin"].isNull(), ok, name.c_str());
    if (ok)
      TEST_ASSERT_EQUAL_STRING_MESSAGE(c["origin"].as<const char *>(), out, name.c_str());
  }
  index = 0;
  for (JsonObjectConst c : doc["cases"].as<JsonArrayConst>())
  {
    const char *origin = c["origin"].isNull() ? nullptr : c["origin"].as<const char *>();
    const std::string name = label("origin", index++) + " " + (origin ? origin : "(none)");
    TEST_ASSERT_EQUAL_MESSAGE(c["allowed"].as<bool>(), net::origin_allowed(origin, site), name.c_str());
  }
}

void test_wifi_cases()
{
  JsonDocument doc = load("net/wifi.json");
  for (JsonArrayConst c : doc["backoff_ms"].as<JsonArrayConst>())
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(c[1].as<uint32_t>(), net::reconnect_wait_ms(c[0].as<uint32_t>()),
                                     label("backoff", c[0].as<size_t>()).c_str());
  for (JsonArrayConst c : doc["disconnect"].as<JsonArrayConst>())
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c[1].as<const char *>(),
                                     net::wifi_state_name(net::state_for_disconnect(c[0].as<uint8_t>())),
                                     label("reason", c[0].as<size_t>()).c_str());
  size_t index = 0;
  for (JsonObjectConst c : doc["power"].as<JsonArrayConst>())
  {
    net::WifiPower power;
    TEST_ASSERT_TRUE(net::wifi_power_from_name(c["setting"].as<const char *>(), power));
    TEST_ASSERT_EQUAL_INT_MESSAGE(
        c["quarter_dbm"].as<int>(),
        net::effective_power_quarter_dbm(power, c["failures"].as<uint32_t>(), c["fell_back"].as<bool>()),
        label("power", index++).c_str());
  }
  net::RetryTimer timer;
  for (JsonObjectConst c : doc["server_retry"]["steps"].as<JsonArrayConst>())
  {
    const std::string name = "server retry at " + std::to_string(c["at"].as<uint32_t>());
    TEST_ASSERT_EQUAL_MESSAGE(c["due"].as<bool>(), timer.due(c["at"].as<uint32_t>()), name.c_str());
    const std::string then = c["then"] | "";
    if (then == "fail")
      timer.failed(c["at"].as<uint32_t>());
    else if (then == "reset")
      timer.reset();
  }
  for (JsonObjectConst c : doc["hostname"].as<JsonArrayConst>())
  {
    uint8_t mac[6];
    for (size_t i = 0; i < 6; i++)
      mac[i] = c["mac"][i].as<uint8_t>();
    char name[11];
    net::hostname_from_mac(mac, name);
    TEST_ASSERT_EQUAL_STRING(c["name"].as<const char *>(), name);
  }
  index = 0;
  for (JsonObjectConst c : doc["ssid"].as<JsonArrayConst>())
    TEST_ASSERT_EQUAL_MESSAGE(c["valid"].as<bool>(), net::valid_wifi_name(c["text"].as<const char *>()),
                              label("ssid", index++).c_str());
  for (JsonObjectConst c : doc["scan_ssid_field"].as<JsonArrayConst>())
  {
    const std::vector<uint8_t> bytes = unhex(c["field_hex"].as<const char *>());
    TEST_ASSERT_EQUAL_size_t(net::MAX_SSID + 1, bytes.size());
    uint8_t field[net::MAX_SSID + 1];
    std::memcpy(field, bytes.data(), sizeof(field));
    size_t length = 99;
    const bool ok = net::scan_ssid_length(field, length);
    TEST_ASSERT_EQUAL_MESSAGE(!c["length"].isNull(), ok, c["note"].as<const char *>());
    if (ok)
      TEST_ASSERT_EQUAL_size_t_MESSAGE(c["length"].as<size_t>(), length, c["note"].as<const char *>());
  }
  for (JsonObjectConst c : doc["ssid_bytes"].as<JsonArrayConst>())
  {
    const std::vector<uint8_t> bytes = unhex(c["hex"].as<const char *>());
    const std::string name(bytes.begin(), bytes.end());
    TEST_ASSERT_EQUAL_MESSAGE(c["valid"].as<bool>(), net::valid_wifi_name(name.c_str()), c["note"].as<const char *>());
  }
  index = 0;
  for (JsonObjectConst c : doc["password"].as<JsonArrayConst>())
    TEST_ASSERT_EQUAL_MESSAGE(c["valid"].as<bool>(), net::valid_wifi_password(c["text"].as<const char *>()),
                              label("password", index++).c_str());
}

namespace
{
// The settings of a case, with the names the protocol uses plus the stored network.
void read_board_settings(JsonObjectConst json, net::BoardSettings &s)
{
  TEST_ASSERT_TRUE(net::wifi_power_from_name(json["wifi_power"].as<const char *>(), s.wifi_power));
  TEST_ASSERT_TRUE(net::update_mode_from_name(json["update_mode"].as<const char *>(), s.update_mode));
  s.update_firmware = json["update_firmware"].as<bool>();
  s.update_web = json["update_web"].as<bool>();
  s.check_hours = json["check_hours"].as<uint8_t>();
  s.install_start = json["install_start"].as<uint16_t>();
  s.install_end = json["install_end"].as<uint16_t>();
  copy(s.timezone, json["timezone"]);
  s.time_sync_hours = json["time_sync_hours"].as<uint8_t>();
  copy(s.ntp_server, json["ntp_server"]);
  s.network_login = json["network_login"].as<bool>();
  copy(s.token, json["token"]);
  copy(s.wifi_ssid, json["wifi_ssid"]);
  copy(s.wifi_password, json["wifi_password"]);
}
} // namespace

void test_board_record_cases()
{
  JsonDocument doc = load("board/record.json");
  size_t index = 0;
  for (JsonObjectConst c : doc["encode"].as<JsonArrayConst>())
  {
    net::BoardSettings s;
    read_board_settings(c["settings"], s);
    uint8_t record[net::BOARD_RECORD_SIZE];
    net::encode_board_record(s, record);
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["record_hex"].as<const char *>(), hex_of(record, sizeof(record)).c_str(),
                                     label("encode", index++).c_str());
  }
  index = 0;
  for (JsonObjectConst c : doc["decode"].as<JsonArrayConst>())
  {
    const std::string name = label("decode", index++) + " " + (c["note"] | "");
    net::BoardSettings expected;
    read_board_settings(c["settings"], expected);
    const std::vector<uint8_t> bytes = unhex(c["record_hex"].as<const char *>());
    net::BoardSettings actual;
    const bool used = net::decode_board_record(bytes.data(), bytes.size(), actual);
    TEST_ASSERT_EQUAL_MESSAGE(c["used"].as<bool>(), used, name.c_str());
    TEST_ASSERT_TRUE_MESSAGE(actual == expected, name.c_str());
  }
}

void test_semver_cases()
{
  JsonDocument doc = load("update/semver.json");
  size_t index = 0;
  for (JsonObjectConst c : doc["compare"].as<JsonArrayConst>())
  {
    update::Version a, b;
    const std::string name =
        label("compare", index++) + " " + c["a"].as<const char *>() + " " + c["b"].as<const char *>();
    TEST_ASSERT_TRUE_MESSAGE(update::parse_version(c["a"].as<const char *>(), a), name.c_str());
    TEST_ASSERT_TRUE_MESSAGE(update::parse_version(c["b"].as<const char *>(), b), name.c_str());
    TEST_ASSERT_EQUAL_INT_MESSAGE(c["order"].as<int>(), update::compare_versions(a, b), name.c_str());
    TEST_ASSERT_EQUAL_INT_MESSAGE(-c["order"].as<int>(), update::compare_versions(b, a), name.c_str());
  }
  for (JsonVariantConst v : doc["valid"].as<JsonArrayConst>())
  {
    update::Version version;
    TEST_ASSERT_TRUE_MESSAGE(update::parse_version(v.as<const char *>(), version), v.as<const char *>());
  }
  for (JsonVariantConst v : doc["invalid"].as<JsonArrayConst>())
  {
    update::Version version;
    TEST_ASSERT_FALSE_MESSAGE(update::parse_version(v.as<const char *>(), version), v.as<const char *>());
  }
  for (JsonObjectConst c : doc["release"].as<JsonArrayConst>())
    TEST_ASSERT_EQUAL_MESSAGE(c["release"].as<bool>(), update::is_release(c["text"].as<const char *>()),
                              c["text"].as<const char *>());
  for (JsonObjectConst c : doc["judge"].as<JsonArrayConst>())
  {
    const update::Candidate got = update::judge(c["running"].as<const char *>(), c["published"].as<const char *>(),
                                                c["skipped"].as<const char *>());
    const char *name = got == update::Candidate::Available ? "available"
                       : got == update::Candidate::Skipped ? "skipped"
                                                           : "up_to_date";
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["result"].as<const char *>(), name, c["published"].as<const char *>());
  }
}

// The bytes of a web image case: the header from its fields, then the body and any tail.
std::vector<uint8_t> web_image_of(JsonObjectConst c)
{
  JsonObjectConst h = c["header"];
  const std::vector<uint8_t> body = unhex(c["body_hex"].as<const char *>());
  std::vector<uint8_t> image(net::WEB_HEADER_SIZE, 0);
  std::memcpy(image.data(), h["magic"].as<const char *>(), 4);
  image[4] = h["format"].as<uint8_t>();
  image[5] = h["protocol_min"].as<uint8_t>();
  image[6] = h["protocol_max"].as<uint8_t>();
  image[7] = h["reserved7"] | 0;
  const char *version = h["version"].as<const char *>();
  std::memcpy(image.data() + 8, version, std::strlen(version));
  const uint16_t count = h["count"].as<uint16_t>();
  image[24] = count & 0xFF;
  image[25] = count >> 8;
  image[26] = image[27] = h["reserved26"] | 0;
  const uint32_t size = h["body_size"].as<uint32_t>();
  for (int i = 0; i < 4; i++)
    image[28 + i] = static_cast<uint8_t>(size >> (8 * i));
  const std::string sha = h["sha256"].as<const char *>();
  if (sha == "of_body")
  {
    net::Sha256 hash;
    hash.update(body.data(), body.size());
    uint8_t digest[net::SHA256_SIZE];
    TEST_ASSERT_TRUE(hash.finish(digest));
    std::memcpy(image.data() + 32, digest, sizeof(digest));
  }
  else
  {
    const std::vector<uint8_t> digest = unhex(sha.c_str());
    std::memcpy(image.data() + 32, digest.data(), net::SHA256_SIZE);
  }
  image.insert(image.end(), body.begin(), body.end());
  if (c["tail_hex"].is<const char *>())
  {
    const std::vector<uint8_t> tail = unhex(c["tail_hex"].as<const char *>());
    image.insert(image.end(), tail.begin(), tail.end());
  }
  return image;
}

void test_web_image_cases()
{
  JsonDocument doc = load("update/web_image.json");
  for (JsonObjectConst c : doc["cases"].as<JsonArrayConst>())
  {
    const std::string name = c["note"].as<std::string>();
    const std::vector<uint8_t> image = web_image_of(c);
    net::WebImageInfo info;
    net::Asset assets[net::MAX_WEB_FILES];
    size_t count = 0;
    const char *why = "";
    const bool valid = net::read_web_image(image.data(), image.size(), info, assets, count, why);
    TEST_ASSERT_EQUAL_MESSAGE(c["valid"].as<bool>(), valid, (name + ": " + why).c_str());
    if (!valid)
      continue;
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["header"]["version"].as<const char *>(), info.version, name.c_str());
    JsonArrayConst files = c["files"];
    TEST_ASSERT_EQUAL_size_t_MESSAGE(files.size(), count, name.c_str());
    const uint8_t *body = image.data() + net::WEB_HEADER_SIZE;
    for (size_t n = 0; n < count; n++)
    {
      TEST_ASSERT_EQUAL_STRING_MESSAGE(files[n]["path"].as<const char *>(), assets[n].path, name.c_str());
      TEST_ASSERT_EQUAL_STRING_MESSAGE(files[n]["type"].as<const char *>(), assets[n].content_type, name.c_str());
      TEST_ASSERT_EQUAL_PTR_MESSAGE(body + files[n]["offset"].as<size_t>(), assets[n].data, name.c_str());
      TEST_ASSERT_EQUAL_size_t_MESSAGE(files[n]["length"].as<size_t>(), assets[n].size, name.c_str());
    }
  }
}

void test_web_manifest_cases()
{
  JsonDocument doc = load("update/web_manifest.json");
  size_t index = 0;
  for (JsonObjectConst c : doc["cases"].as<JsonArrayConst>())
  {
    const std::string name = label("web manifest", index++) + " " + c["note"].as<std::string>();
    const std::string text = c["text"].as<const char *>();
    update::Manifest manifest;
    const char *why = nullptr;
    const bool valid = update::parse_web_manifest(text.data(), text.size(), manifest, why);
    TEST_ASSERT_EQUAL_MESSAGE(c["valid"].as<bool>(), valid, name.c_str());
    if (!valid)
      continue;
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["version"].as<const char *>(), manifest.version, name.c_str());
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["file"].as<const char *>(), manifest.file, name.c_str());
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(c["size"].as<uint32_t>(), manifest.size, name.c_str());
    TEST_ASSERT_EQUAL_UINT8_MESSAGE(c["protocol_min"].as<uint8_t>(), manifest.protocol_min, name.c_str());
    TEST_ASSERT_EQUAL_UINT8_MESSAGE(c["protocol_max"].as<uint8_t>(), manifest.protocol_max, name.c_str());
  }
}

void test_manifest_cases()
{
  JsonDocument doc = load("update/manifest.json");
  size_t index = 0;
  for (JsonObjectConst c : doc["cases"].as<JsonArrayConst>())
  {
    const std::string name = label("manifest", index++);
    const std::string text = c["text"].as<const char *>();
    update::Manifest manifest;
    const char *why = nullptr;
    const bool valid = update::parse_manifest(text.data(), text.size(), manifest, why);
    TEST_ASSERT_EQUAL_MESSAGE(c["valid"].as<bool>(), valid, (name + ": " + text.substr(0, 80)).c_str());
    if (!valid)
      continue;
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["version"].as<const char *>(), manifest.version, name.c_str());
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["file"].as<const char *>(), manifest.file, name.c_str());
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(c["size"].as<uint32_t>(), manifest.size, name.c_str());
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["sha256"].as<const char *>(), manifest.sha256, name.c_str());
  }
  for (JsonObjectConst c : doc["firmware_url"].as<JsonArrayConst>())
  {
    update::Manifest manifest;
    copy(manifest.file, c["file"]);
    char url[160];
    TEST_ASSERT_TRUE(update::firmware_url(c["manifest_url"].as<const char *>(), manifest, url, sizeof(url)));
    TEST_ASSERT_EQUAL_STRING(c["url"].as<const char *>(), url);
    char tiny[8];
    TEST_ASSERT_FALSE(update::firmware_url(c["manifest_url"].as<const char *>(), manifest, tiny, sizeof(tiny)));
  }
}

void test_schedule_cases()
{
  JsonDocument doc = load("update/schedule.json");
  size_t index = 0;
  for (JsonObjectConst c : doc["window"].as<JsonArrayConst>())
    TEST_ASSERT_EQUAL_MESSAGE(
        c["in"].as<bool>(),
        update::in_window(c["start"].as<uint16_t>(), c["end"].as<uint16_t>(), c["minute"].as<uint16_t>()),
        label("window", index++).c_str());
  index = 0;
  for (JsonObjectConst c : doc["check_due"].as<JsonArrayConst>())
    TEST_ASSERT_EQUAL_MESSAGE(c["due"].as<bool>(),
                              update::check_due(c["now"].as<uint64_t>(), c["ready"].as<uint64_t>(),
                                                c["attempted"].as<bool>(), c["last"].as<uint64_t>(),
                                                c["failed"].as<bool>(), c["hours"].as<uint32_t>()),
                              label("check", index++).c_str());
}

void test_boot_cases()
{
  JsonDocument doc = load("update/boot.json");
  size_t index = 0;
  for (JsonObjectConst c : doc["settled"].as<JsonArrayConst>())
  {
    const std::string name = label("settled", index++);
    update::UpdateRecord record;
    update::set_version(record.pending, c["pending"].as<const char *>());
    record.booted = c["booted"].as<bool>();
    const update::BootAction action =
        update::decide_settled_boot(record, c["running"].as<const char *>(), c["other_invalid"].as<bool>());
    const std::string want = c["action"].as<const char *>();
    const char *got = action == update::BootAction::Nothing    ? "nothing"
                      : action == update::BootAction::Rollback ? "rollback"
                                                               : "drop";
    TEST_ASSERT_EQUAL_STRING_MESSAGE(want.c_str(), got, name.c_str());
    const update::UpdateRecord after = update::apply_boot_action(record, action);
    if (want == "nothing")
      continue;
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["skipped"].as<const char *>(), after.skipped, name.c_str());
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["rolled_back"].as<const char *>(), after.rolled_back, name.c_str());
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["pending_after"].as<const char *>(), after.pending, name.c_str());
  }
  index = 0;
  for (JsonObjectConst c : doc["confirmed"].as<JsonArrayConst>())
  {
    const std::string name = label("confirmed", index++);
    update::UpdateRecord record;
    update::set_version(record.pending, c["pending"].as<const char *>());
    update::set_version(record.skipped, c["skipped"].as<const char *>());
    update::set_version(record.rolled_back, c["rolled_back"].as<const char *>());
    const update::BootAction action = update::decide_confirmed_trial(record, c["running"].as<const char *>());
    const char *got = action == update::BootAction::Nothing       ? "nothing"
                      : action == update::BootAction::DropPending ? "drop"
                      : action == update::BootAction::SkipPending ? "skip"
                                                                  : "other";
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["action"].as<const char *>(), got, name.c_str());
    const update::UpdateRecord after = update::apply_confirmed(record, c["running"].as<const char *>());
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["pending_after"].as<const char *>(), after.pending, name.c_str());
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["skipped_after"].as<const char *>(), after.skipped, name.c_str());
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["rolled_back_after"].as<const char *>(), after.rolled_back, name.c_str());
  }
  for (JsonObjectConst c : doc["ran"].as<JsonArrayConst>())
  {
    update::UpdateRecord record;
    update::set_version(record.pending, c["pending"].as<const char *>());
    TEST_ASSERT_EQUAL(c["booted_after"].as<bool>(), update::apply_booted(record).booted);
  }
  // The record survives its stored form, and a damaged one is empty.
  update::UpdateRecord record;
  update::set_version(record.pending, "1.2.3");
  update::set_version(record.skipped, "1.2.2-rc.1");
  record.booted = true;
  uint8_t bytes[update::UPDATE_RECORD_SIZE];
  update::encode_update_record(record, bytes);
  update::UpdateRecord back;
  TEST_ASSERT_TRUE(update::decode_update_record(bytes, sizeof(bytes), back));
  TEST_ASSERT_TRUE(back == record);
  TEST_ASSERT_FALSE(update::decode_update_record(bytes, sizeof(bytes) - 1, back));
  bytes[0] = 9;
  TEST_ASSERT_FALSE(update::decode_update_record(bytes, sizeof(bytes), back));
  bytes[0] = update::UPDATE_RECORD_VERSION;
  std::memset(bytes + 1, 'x', update::RECORD_VERSION_TEXT);
  TEST_ASSERT_FALSE(update::decode_update_record(bytes, sizeof(bytes), back));
  TEST_ASSERT_TRUE(back == update::UpdateRecord());
}

void test_http_cases()
{
  JsonDocument doc = load("net/http.json");
  std::vector<std::string> paths;
  for (JsonVariantConst p : doc["assets"].as<JsonArrayConst>())
    paths.push_back(p.as<const char *>());
  static const uint8_t BODY[1] = {0};
  std::vector<net::Asset> assets;
  for (const std::string &p : paths)
    assets.push_back({p.c_str(), "text/plain", BODY, sizeof(BODY), p.rfind("assets/", 0) == 0});
  size_t index = 0;
  for (JsonObjectConst c : doc["cases"].as<JsonArrayConst>())
  {
    const std::string name = label("route", index++) + " " + c["uri"].as<const char *>();
    const net::Resolved r = net::resolve(assets.data(), assets.size(), c["uri"].as<const char *>());
    const std::string want = c["route"].as<const char *>();
    const char *got = r.route == net::Route::Asset       ? "asset"
                      : r.route == net::Route::BoardJson ? "board_json"
                                                         : "not_found";
    TEST_ASSERT_EQUAL_STRING_MESSAGE(want.c_str(), got, name.c_str());
    if (want == "asset")
      TEST_ASSERT_EQUAL_STRING_MESSAGE(c["asset"].as<const char *>(), r.asset->path, name.c_str());
  }
  char body[96];
  const size_t size = net::board_json(doc["board_json"]["hostname"].as<const char *>(), body, sizeof(body));
  TEST_ASSERT_EQUAL_STRING(doc["board_json"]["body"].as<const char *>(), body);
  TEST_ASSERT_EQUAL_size_t(std::strlen(body), size);
  char tiny[8];
  TEST_ASSERT_EQUAL_size_t(0, net::board_json("zenit-a1b2", tiny, sizeof(tiny)));
  for (JsonObjectConst c : doc["immutable"].as<JsonArrayConst>())
  {
    const std::string wanted = c["asset"].as<const char *>();
    for (const net::Asset &a : assets)
      if (wanted == a.path)
        TEST_ASSERT_EQUAL_STRING(c["cache_control"].as<const char *>(), net::cache_control(a));
  }
  // Every answer carries the same headers: the policy, no sniffing, no referrer.
  bool csp = false, nosniff = false;
  for (size_t i = 0; i < net::COMMON_HEADER_COUNT; i++)
  {
    csp = csp || (std::strcmp(net::COMMON_HEADERS[i].name, "Content-Security-Policy") == 0 &&
                  std::strstr(net::COMMON_HEADERS[i].value, "default-src 'self'") &&
                  std::strstr(net::COMMON_HEADERS[i].value, "object-src 'none'"));
    nosniff = nosniff || std::strcmp(net::COMMON_HEADERS[i].name, "X-Content-Type-Options") == 0;
  }
  TEST_ASSERT_TRUE(csp);
  TEST_ASSERT_TRUE(nosniff);
}

void test_ws_message_cases()
{
  namespace proto = zenit::proto;
  JsonDocument doc = load("net/ws_message.json");
  for (JsonObjectConst c : doc["cases"].as<JsonArrayConst>())
  {
    const std::string name = c["name"].as<const char *>();
    proto::MessageAssembler assembler;
    proto::MessageAssembler::Result last = proto::MessageAssembler::Result::More;
    auto word = [](proto::MessageAssembler::Result r, uint16_t code)
    {
      return r == proto::MessageAssembler::Result::More   ? std::string("more")
             : r == proto::MessageAssembler::Result::Line ? std::string("line")
                                                          : "close:" + std::to_string(code);
    };
    for (JsonObjectConst f : c["frames"].as<JsonArrayConst>())
    {
      const std::string kind = f["kind"].as<const char *>();
      const proto::FrameKind frame_kind = kind == "text"     ? proto::FrameKind::Text
                                          : kind == "binary" ? proto::FrameKind::Binary
                                                             : proto::FrameKind::Continuation;
      if (!f["announced"].isNull())
      {
        // A header that claims a length with no payload behind it: the assembler must refuse it before any read
        const size_t announced = f["announced"].is<const char *>() && std::string(f["announced"]) == "max"
                                     ? SIZE_MAX
                                     : f["announced"].as<size_t>();
        last = assembler.begin_frame(frame_kind, announced);
        TEST_ASSERT_EQUAL_STRING_MESSAGE(f["begin"].as<const char *>(), word(last, assembler.code()).c_str(),
                                         name.c_str());
        TEST_ASSERT_TRUE_MESSAGE(last == proto::MessageAssembler::Result::Close, name.c_str());
        break;
      }
      std::vector<uint8_t> payload =
          f["hex"].is<const char *>()
              ? unhex(f["hex"].as<const char *>())
              : std::vector<uint8_t>(f["size"].as<size_t>(), unhex(f["fill"].as<const char *>())[0]);
      last = assembler.begin_frame(frame_kind, payload.size());
      TEST_ASSERT_EQUAL_STRING_MESSAGE(f["begin"].as<const char *>(), word(last, assembler.code()).c_str(),
                                       name.c_str());
      if (last == proto::MessageAssembler::Result::Close)
        break;
      last = assembler.end_frame(f["final"].as<bool>(), payload.data(), payload.size());
      TEST_ASSERT_EQUAL_STRING_MESSAGE(f["end"].as<const char *>(), word(last, assembler.code()).c_str(), name.c_str());
    }
    if (c["line"].is<const char *>() && last == proto::MessageAssembler::Result::Line)
      TEST_ASSERT_EQUAL_STRING_MESSAGE(c["line"].as<const char *>(), assembler.line(), name.c_str());
    if (c["line_hex"].is<const char *>())
      TEST_ASSERT_EQUAL_STRING_MESSAGE(
          c["line_hex"].as<const char *>(),
          hex_of(reinterpret_cast<const uint8_t *>(assembler.line()), assembler.line_size()).c_str(), name.c_str());
  }
  // A caller that hands end_frame a longer payload than begin_frame accepted gets 1009, and nothing is copied
  proto::MessageAssembler assembler;
  const std::vector<uint8_t> long_payload(proto::MAX_LINE + 1, 'a');
  TEST_ASSERT_TRUE(assembler.begin_frame(proto::FrameKind::Text, 1) == proto::MessageAssembler::Result::More);
  TEST_ASSERT_TRUE(assembler.end_frame(true, long_payload.data(), long_payload.size()) ==
                   proto::MessageAssembler::Result::Close);
  TEST_ASSERT_EQUAL_UINT16(proto::CLOSE_TOO_BIG, assembler.code());
  // and so does end_frame with no frame begun
  proto::MessageAssembler idle;
  TEST_ASSERT_TRUE(idle.end_frame(true, long_payload.data(), 1) == proto::MessageAssembler::Result::Close);
}

void test_improv_cases()
{
  namespace improv = zenit::improv;
  JsonDocument doc = load("improv/frames.json");
  for (JsonObjectConst c : doc["packets"].as<JsonArrayConst>())
  {
    const std::string name = c["name"].as<const char *>();
    std::string got;
    if (c["state"].is<int>())
      got = improv::state_packet(static_cast<improv::State>(c["state"].as<int>()));
    else if (c["error"].is<int>())
      got = improv::error_packet(static_cast<improv::Error>(c["error"].as<int>()));
    else
    {
      std::vector<std::string> strings;
      for (JsonVariantConst s : c["strings"].as<JsonArrayConst>())
        strings.push_back(s.as<const char *>());
      got = improv::result_packet(static_cast<improv::Command>(c["command"].as<int>()), strings);
    }
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["hex"].as<const char *>(), hex_of(got).c_str(), name.c_str());
  }
  for (JsonObjectConst c : doc["wifi_settings"].as<JsonArrayConst>())
  {
    const std::vector<uint8_t> args = unhex(c["args_hex"].as<const char *>());
    std::string ssid, password;
    TEST_ASSERT_TRUE(improv::parse_wifi_settings(std::string(args.begin(), args.end()), ssid, password));
    TEST_ASSERT_EQUAL_STRING(c["ssid"].as<const char *>(), ssid.c_str());
    TEST_ASSERT_EQUAL_STRING(c["password"].as<const char *>(), password.c_str());
  }
  for (JsonVariantConst v : doc["wifi_settings_invalid"].as<JsonArrayConst>())
  {
    const std::vector<uint8_t> args = unhex(v.as<const char *>());
    std::string ssid, password;
    TEST_ASSERT_FALSE_MESSAGE(improv::parse_wifi_settings(std::string(args.begin(), args.end()), ssid, password),
                              v.as<const char *>());
  }
  for (JsonObjectConst c : doc["streams"].as<JsonArrayConst>())
  {
    const std::string name = c["name"].as<const char *>();
    const std::vector<uint8_t> bytes = unhex(c["hex"].as<const char *>());
    improv::Demux demux;
    // What came out, with the bytes handed to the line reader joined into one run.
    std::vector<std::string> got;
    std::string pass;
    auto flush = [&]()
    {
      if (!pass.empty())
        got.push_back("pass:" + hex_of(pass));
      pass.clear();
    };
    for (uint8_t b : bytes)
    {
      switch (demux.feed(b, 0))
      {
      case improv::Demux::Result::Consumed:
        break;
      case improv::Demux::Result::Passthrough:
        pass.append(reinterpret_cast<const char *>(demux.pending()), demux.pending_size());
        break;
      case improv::Demux::Result::Frame:
        flush();
        got.push_back("frame:" + std::to_string(demux.type()) + ":" + hex_of(demux.data()));
        break;
      case improv::Demux::Result::BadChecksum:
        flush();
        got.push_back("bad_checksum");
        break;
      }
    }
    flush();
    std::vector<std::string> want;
    std::string want_pass;
    auto want_flush = [&]()
    {
      if (!want_pass.empty())
        want.push_back("pass:" + want_pass);
      want_pass.clear();
    };
    for (JsonObjectConst e : c["events"].as<JsonArrayConst>())
    {
      if (e["pass_hex"].is<const char *>())
        want_pass += e["pass_hex"].as<const char *>();
      else if (e["frame"].is<JsonObjectConst>())
      {
        want_flush();
        want.push_back("frame:" + std::to_string(e["frame"]["type"].as<int>()) + ":" +
                       e["frame"]["data_hex"].as<const char *>());
      }
      else
      {
        want_flush();
        want.push_back("bad_checksum");
      }
    }
    want_flush();
    TEST_ASSERT_EQUAL_size_t_MESSAGE(want.size(), got.size(), name.c_str());
    for (size_t i = 0; i < want.size(); i++)
      TEST_ASSERT_EQUAL_STRING_MESSAGE(want[i].c_str(), got[i].c_str(), name.c_str());
  }
  // A frame that stops is dropped after a second, and the next bytes are read fresh.
  improv::Demux demux;
  demux.feed('I', 0);
  demux.feed('M', 10);
  TEST_ASSERT_FALSE(demux.idle(500));
  TEST_ASSERT_TRUE(demux.idle(1500));
  TEST_ASSERT_TRUE(demux.feed('x', 1600) == improv::Demux::Result::Passthrough);
}

void test_scan_cases()
{
  JsonDocument doc = load("net/scan.json");
  for (JsonObjectConst c : doc["cases"].as<JsonArrayConst>())
  {
    const std::string name = c["name"].as<const char *>();
    const size_t capacity = c["capacity"].as<size_t>();
    std::vector<net::ScanEntry> list(capacity);
    size_t count = 0;
    for (JsonObjectConst f : c["found"].as<JsonArrayConst>())
    {
      // The name goes in as the bytes it is, of whatever length
      const std::string ssid = f["ssid"].as<const char *>();
      net::scan_add(list.data(), count, capacity, ssid.data(), ssid.size(), f["rssi"].as<int>(),
                    f["secure"].as<bool>());
    }
    net::scan_sort(list.data(), count);
    JsonArrayConst expect = c["expect"].as<JsonArrayConst>();
    TEST_ASSERT_EQUAL_size_t_MESSAGE(expect.size(), count, name.c_str());
    for (size_t i = 0; i < count; i++)
    {
      TEST_ASSERT_EQUAL_STRING_MESSAGE(expect[i]["ssid"].as<const char *>(), list[i].ssid, name.c_str());
      TEST_ASSERT_EQUAL_INT_MESSAGE(expect[i]["rssi"].as<int>(), list[i].rssi, name.c_str());
      TEST_ASSERT_EQUAL_MESSAGE(expect[i]["secure"].as<bool>(), list[i].secure, name.c_str());
    }
  }
}

void test_stored_settings_cases()
{
  JsonDocument doc = load("board/stored.json");
  for (JsonObjectConst c : doc["cases"].as<JsonArrayConst>())
  {
    const std::string name = c["note"].as<const char *>();
    settings::sim_clear();
    for (JsonPairConst key : c["keys"].as<JsonObjectConst>())
      settings::sim_write_raw(key.key().c_str(), unhex(key.value().as<const char *>()));
    settings::begin();
    JsonObjectConst expect = c["expect"];
    TEST_ASSERT_EQUAL_UINT8_MESSAGE(expect["brightness"].as<uint8_t>(), settings::current().brightness, name.c_str());
    TEST_ASSERT_EQUAL_STRING_MESSAGE(expect["effect"].as<const char *>(),
                                     zenit::effect_name(settings::current().effect), name.c_str());
    TEST_ASSERT_EQUAL_UINT8_MESSAGE(expect["check_hours"].as<uint8_t>(), settings::board().check_hours, name.c_str());
    if (expect["color_set"].is<const char *>())
      TEST_ASSERT_EQUAL_STRING_MESSAGE(expect["color_set"].as<const char *>(),
                                       zenit::color_set_name(settings::current().color_set), name.c_str());
    if (expect["breath_pattern"].is<const char *>())
      TEST_ASSERT_EQUAL_STRING_MESSAGE(expect["breath_pattern"].as<const char *>(),
                                       zenit::breath_pattern_name(settings::current().breath_pattern), name.c_str());
    if (expect["token"].isNull())
      TEST_ASSERT_TRUE_MESSAGE(net::valid_token(settings::board().token), name.c_str());
    else
      TEST_ASSERT_EQUAL_STRING_MESSAGE(expect["token"].as<const char *>(), settings::board().token, name.c_str());
  }
}
