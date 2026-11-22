// SPDX-License-Identifier: GPL-3.0-or-later

// Runs the cases of conformance/light against the light engine, and those of conformance/protocol against the
// protocol core with a virtual clock.

#include <unity.h>

#include <frame.h>
#include <line_reader.h>
#include <proto_limits.h>
#include <strict_json.h>

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <regex>
#include <string>
#include <vector>

#include "app.h"
#include "firmware.h"
#include "network.h"
#include "update_http.h"
#include "updates.h"
#include "www.h"
#include "platform.h"
#include "protocol.h"
#include "settings.h"
#include "sim_control.h"
#include "net_cases.h"
#include "zenit_test.h"

namespace fs = std::filesystem;

namespace
{
const std::string LIGHT = zenit_test::PROJECT_DIR + "/conformance/light";

JsonDocument load(const std::string &path)
{
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, zenit_test::read_file(path));
  TEST_ASSERT_FALSE_MESSAGE(error, (path + ": " + error.c_str()).c_str());
  return doc;
}
} // namespace

void setUp() {}
void tearDown() {}

void test_curve()
{
  JsonDocument doc = load(LIGHT + "/curve.json");
  for (JsonObjectConst c : doc["cases"].as<JsonArrayConst>())
  {
    double lightness = c["lightness"].as<double>();
    std::string label = "lightness " + std::to_string(lightness);
    TEST_ASSERT_EQUAL_UINT16_MESSAGE(c["duty"].as<uint16_t>(), zenit::lightness_to_duty(lightness), label.c_str());
  }
}

void test_power()
{
  JsonDocument doc = load(LIGHT + "/power.json");
  int index = 0;
  for (JsonObjectConst c : doc["cases"].as<JsonArrayConst>())
  {
    zenit::Duties duties;
    for (size_t i = 0; i < zenit::CHANNEL_COUNT; i++)
      duties.value[i] = c["duties"][i].as<uint16_t>();
    uint8_t scale = zenit::apply_power_limit(duties, c["limit_mw"].as<uint32_t>());
    std::string label = "power case " + std::to_string(index++);
    for (size_t i = 0; i < zenit::CHANNEL_COUNT; i++)
      TEST_ASSERT_EQUAL_UINT16_MESSAGE(c["expect"][i].as<uint16_t>(), duties.value[i], label.c_str());
    TEST_ASSERT_EQUAL_UINT8_MESSAGE(c["power_scale"].as<uint8_t>(), scale, label.c_str());
  }
}

void run_sequence(const fs::path &path)
{
  JsonDocument doc = load(path.string());
  const std::string name = path.stem().string();
  zenit::LightSettings settings;
  std::string error;
  TEST_ASSERT_TRUE_MESSAGE(zenit_test::apply_settings(settings, doc["settings"].as<JsonObjectConst>(), error),
                           (name + ": " + error).c_str());

  zenit::LightEngine engine;
  if (doc["limit_mw"].is<uint32_t>())
    engine.set_power_limit(doc["limit_mw"].as<uint32_t>());
  engine.start(settings, 0, doc["seed"] | 1u);

  JsonArrayConst events = doc["events"].as<JsonArrayConst>();
  size_t next_event = 0;
  uint64_t now = 0;
  for (JsonObjectConst expect : doc["expect"].as<JsonArrayConst>())
  {
    const uint64_t at = expect["at"].as<uint64_t>();
    // Tick every 10 ms up to the expected time, as the board does, running the events on the way, and at the
    // expected time itself when it is not on the 10 ms grid.
    zenit::LightFrame frame;
    auto tick_at = [&](uint64_t t)
    {
      while (next_event < events.size() && events[next_event]["at"].as<uint64_t>() <= t)
      {
        JsonObjectConst event = events[next_event++];
        if (event["light"].is<bool>())
          engine.set_on(event["light"].as<bool>(), t);
        else
        {
          zenit::LightSettings next = engine.settings();
          TEST_ASSERT_TRUE_MESSAGE(zenit_test::apply_settings(next, event["set"].as<JsonObjectConst>(), error),
                                   (name + ": " + error).c_str());
          engine.apply(next, t);
        }
      }
      frame = engine.tick(t);
    };
    for (; now <= at; now += zenit::TICK_MS)
      tick_at(now);
    if ((now - zenit::TICK_MS) != at)
      tick_at(at);
    const std::string label = name + " at " + std::to_string(at);
    for (size_t i = 0; i < zenit::CHANNEL_COUNT; i++)
      TEST_ASSERT_EQUAL_UINT16_MESSAGE(expect["duties"][i].as<uint16_t>(), frame.duties.value[i], label.c_str());
    if (expect["on"].is<bool>())
      TEST_ASSERT_EQUAL_MESSAGE(expect["on"].as<bool>(), frame.status.on, (label + " on").c_str());
    if (expect["power_scale"].is<uint8_t>())
      TEST_ASSERT_EQUAL_UINT8_MESSAGE(expect["power_scale"].as<uint8_t>(), frame.status.power_scale, label.c_str());
    if (expect["timer_remaining_s"].is<uint32_t>())
      TEST_ASSERT_EQUAL_UINT32_MESSAGE(expect["timer_remaining_s"].as<uint32_t>(), frame.status.timer_remaining_s,
                                       (label + " timer").c_str());
  }
}

void test_record()
{
  JsonDocument doc = load(LIGHT + "/record.json");
  std::string error;
  int index = 0;
  for (JsonObjectConst c : doc["encode"].as<JsonArrayConst>())
  {
    zenit::LightSettings settings;
    std::string label = "encode case " + std::to_string(index++);
    TEST_ASSERT_TRUE_MESSAGE(zenit_test::apply_settings(settings, c["settings"].as<JsonObjectConst>(), error),
                             (label + ": " + error).c_str());
    uint8_t record[zenit::LIGHT_RECORD_SIZE];
    zenit::encode_light_record(settings, record);
    TEST_ASSERT_EQUAL_size_t_MESSAGE(zenit::LIGHT_RECORD_SIZE, c["record"].size(), label.c_str());
    for (size_t i = 0; i < zenit::LIGHT_RECORD_SIZE; i++)
      TEST_ASSERT_EQUAL_UINT8_MESSAGE(c["record"][i].as<uint8_t>(), record[i],
                                      (label + " byte " + std::to_string(i)).c_str());
  }
  index = 0;
  for (JsonObjectConst c : doc["decode"].as<JsonArrayConst>())
  {
    zenit::LightSettings expected;
    std::string label = "decode case " + std::to_string(index++);
    TEST_ASSERT_TRUE_MESSAGE(zenit_test::apply_settings(expected, c["settings"].as<JsonObjectConst>(), error),
                             (label + ": " + error).c_str());
    std::vector<uint8_t> bytes;
    for (JsonVariantConst b : c["record"].as<JsonArrayConst>())
      bytes.push_back(b.as<uint8_t>());
    TEST_ASSERT_TRUE_MESSAGE(zenit::decode_light_record(bytes.data(), bytes.size()) == expected, label.c_str());
  }
}

void test_sequences()
{
  int count = 0;
  for (const auto &entry : fs::directory_iterator(LIGHT + "/sequences"))
    if (entry.path().extension() == ".json")
    {
      run_sequence(entry.path());
      count++;
    }
  TEST_ASSERT_GREATER_THAN(0, count);
}

// ---- Protocol cases ----

namespace
{
const std::string PROTOCOL = zenit_test::PROJECT_DIR + "/conformance/protocol";
constexpr uint32_t BOOT_ID = 4242;

std::vector<std::string> replies;

void collect(const char *line, size_t length) { replies.emplace_back(line, length); }

// Whether `actual` is what `expected` describes. An object `{"$any": "<type>"}` matches any value of that type; every
// other object matches exactly (same keys, no more, no fewer); numbers compare by value.
bool matches(JsonVariantConst expected, JsonVariantConst actual, std::string &why, const std::string &path)
{
  if (expected.is<JsonObjectConst>() && expected["$any"].is<const char *>())
  {
    const std::string type = expected["$any"].as<const char *>();
    const bool ok = (type == "string" && actual.is<const char *>()) || (type == "integer" && actual.is<int64_t>()) ||
                    (type == "boolean" && actual.is<bool>());
    if (!ok)
      why = path + ": not a " + type;
    return ok;
  }
  if (expected.is<JsonObjectConst>() && expected["$pattern"].is<const char *>())
  {
    // A text that matches a regular expression, for what varies with the run (a token, a nonce).
    const bool ok = actual.is<const char *>() &&
                    std::regex_match(actual.as<const char *>(), std::regex(expected["$pattern"].as<const char *>()));
    if (!ok)
      why = path + ": does not match " + expected["$pattern"].as<const char *>();
    return ok;
  }
  if (expected.is<JsonObjectConst>())
  {
    if (!actual.is<JsonObjectConst>())
    {
      why = path + ": not an object";
      return false;
    }
    JsonObjectConst e = expected.as<JsonObjectConst>(), a = actual.as<JsonObjectConst>();
    for (JsonPairConst pair : e)
    {
      if (a[pair.key()].isUnbound())
      {
        why = path + "." + pair.key().c_str() + ": missing";
        return false;
      }
      if (!matches(pair.value(), a[pair.key()], why, path + "." + pair.key().c_str()))
        return false;
    }
    for (JsonPairConst pair : a)
      if (e[pair.key()].isUnbound() && !(path == "$" && pair.key() == "message"))
      {
        why = path + "." + pair.key().c_str() + ": not expected";
        return false;
      }
    return true;
  }
  if (expected.is<JsonArrayConst>())
  {
    if (!actual.is<JsonArrayConst>() || expected.size() != actual.size())
    {
      why = path + ": not the same array";
      return false;
    }
    for (size_t i = 0; i < expected.size(); i++)
      if (!matches(expected[i], actual[i], why, path + "[" + std::to_string(i) + "]"))
        return false;
    return true;
  }
  if (expected.isNull())
  {
    if (!actual.isNull())
      why = path + ": not null";
    return actual.isNull();
  }
  if (expected.is<bool>())
  {
    const bool ok = actual.is<bool>() && actual.as<bool>() == expected.as<bool>();
    if (!ok)
      why = path + ": not " + (expected.as<bool>() ? "true" : "false");
    return ok;
  }
  if (expected.is<const char *>())
  {
    const bool ok = actual.is<const char *>() && std::string(actual.as<const char *>()) == expected.as<const char *>();
    if (!ok)
      why = path + ": not \"" + expected.as<const char *>() + "\"";
    return ok;
  }
  const bool ok = actual.is<double>() && !actual.is<const char *>() && !actual.is<bool>() &&
                  std::fabs(actual.as<double>() - expected.as<double>()) < 1e-9;
  if (!ok)
    why = path + ": not " + std::to_string(expected.as<double>());
  return ok;
}

void start_protocol_case()
{
  replies.clear();
  settings::sim_fail_writes(false);
  settings::sim_clear();
  settings::begin();
  firmware::sim_reset();
  update_http::sim_reset();
  www::sim_reset();
  platform::sim_set_version("0.1.0");
  platform::sim_queue_random_bytes(nullptr, 0);
  sim_control::set_quiet(true);
  platform::sim_set_now_ms(0);
  app::begin(0, 1);
  app::tick(0);
  protocol::begin(BOOT_ID);
  updates::protocol_ready();
}

// The bytes of a line and its newline through the line reader, as the serial port delivers them. A line with a newline
// in it is several lines, as on the port.
void deliver_over_usb(const std::string &line, uint64_t now)
{
  zenit::proto::LineReader reader;
  for (char c : line + "\n")
  {
    const auto event = reader.feed(static_cast<uint8_t>(c));
    if (event == zenit::proto::LineReader::Event::Line)
      protocol::handle_line(protocol::Transport::Usb, reader.line(), reader.length(), now, collect);
    else if (event == zenit::proto::LineReader::Event::TooLong)
      protocol::line_too_long(protocol::Transport::Usb, collect);
  }
}

void run_protocol_case(const fs::path &path)
{
  JsonDocument doc = load(path.string());
  const std::string name = path.stem().string();
  const std::string case_transport = doc["transport"] | "usb";
  start_protocol_case();
  uint64_t now = 0;
  int index = 0;
  for (JsonObjectConst step : doc["steps"].as<JsonArrayConst>())
  {
    const std::string label = name + " step " + std::to_string(index++);
    if (step["advance_ms"].is<uint64_t>())
    {
      const uint64_t until = now + step["advance_ms"].as<uint64_t>();
      for (now += zenit::TICK_MS; now <= until; now += zenit::TICK_MS)
      {
        platform::sim_set_now_ms(now);
        app::tick(now);
        app::service(now);
        sim_control::after_step(now);
      }
      now = until;
      platform::sim_set_now_ms(now);
      continue;
    }
    if (step["close_requested"].is<bool>())
    {
      // Whether a request without a line (a login that took too long) asked to close the WiFi client
      TEST_ASSERT_EQUAL_MESSAGE(step["close_requested"].as<bool>(), protocol::take_wifi_close_request(),
                                (label + ": close request").c_str());
      continue;
    }
    if (step["control"].is<const char *>())
    {
      // A control line of the simulator (see conformance/README.md), run at the current time.
      TEST_ASSERT_TRUE_MESSAGE(sim_control::handle(step["control"].as<const char *>(), now),
                               (label + ": control").c_str());
      continue;
    }
    if (step["event"].is<const char *>())
    {
      const std::string event = step["event"].as<const char *>();
      if (event == "wifi_open")
        protocol::wifi_opened(now);
      else if (event == "wifi_close")
        protocol::wifi_closed();
      else if (event == "storage_fail")
        settings::sim_fail_writes(true);
      else if (event == "storage_ok")
        settings::sim_fail_writes(false);
      else
        TEST_FAIL_MESSAGE((label + ": unknown event " + event).c_str());
      continue;
    }

    // The line to send: a raw string as it is, a request object framed here, or a padded line.
    std::string line;
    JsonVariantConst send = step["send"];
    if (send.is<const char *>())
      line = send.as<const char *>();
    else if (send.is<JsonObjectConst>())
    {
      std::string json;
      serializeJson(send, json);
      char buffer[zenit::proto::MAX_REPLY_LINE + 1];
      const size_t size = zenit::proto::format_frame(buffer, sizeof(buffer), json.data(), json.size());
      TEST_ASSERT_TRUE_MESSAGE(size > 0, label.c_str());
      line.assign(buffer, size - 1);
    }
    else if (step["send_hex"].is<const char *>())
    {
      // Bytes a JSON string cannot carry: invalid UTF-8, a raw NUL. Two hexadecimal digits each.
      const std::string hex = step["send_hex"].as<const char *>();
      for (size_t i = 0; i + 1 < hex.size(); i += 2)
        line += static_cast<char>(std::stoi(hex.substr(i, 2), nullptr, 16));
    }
    else if (step["send_padded"].is<JsonObjectConst>())
    {
      JsonObjectConst padded = step["send_padded"];
      line = std::string(padded["prefix"].as<const char *>()) +
             std::string(padded["count"].as<size_t>(), padded["fill"].as<const char *>()[0]);
    }
    else
      TEST_FAIL_MESSAGE((label + ": a step needs send, send_hex, send_padded, advance_ms or event").c_str());

    const std::string transport = step["transport"] | case_transport.c_str();
    replies.clear();
    if (transport == "wifi")
      // A WebSocket message is one line, as it is.
      protocol::handle_line(protocol::Transport::Wifi, line.data(), line.size(), now, collect);
    else
      deliver_over_usb(line, now);

    // `close`: whether the request asked to close the WiFi client's connection.
    if (step["close"].is<bool>())
      TEST_ASSERT_EQUAL_MESSAGE(step["close"].as<bool>(), protocol::take_wifi_close_request(),
                                (label + ": close request").c_str());
    else
      (void)protocol::take_wifi_close_request();
    if (step["expect"].isNull())
    {
      TEST_ASSERT_EQUAL_size_t_MESSAGE(0, replies.size(), (label + ": a reply came").c_str());
      continue;
    }
    TEST_ASSERT_EQUAL_size_t_MESSAGE(1, replies.size(), (label + ": expected one reply").c_str());
    const std::string &reply = replies[0];
    TEST_ASSERT_TRUE_MESSAGE(reply.size() > 1 && reply.back() == '\n', (label + ": no newline").c_str());
    // Every reply is a well-formed frame with a matching checksum and strict JSON, with no other newline.
    const std::string body = reply.substr(0, reply.size() - 1);
    TEST_ASSERT_TRUE_MESSAGE(body.find('\n') == std::string::npos, (label + ": newline inside").c_str());
    zenit::proto::Frame frame;
    TEST_ASSERT_TRUE_MESSAGE(zenit::proto::parse_frame(body.data(), body.size(), frame) ==
                                 zenit::proto::FrameStatus::Ok,
                             (label + ": reply is not a frame with a good checksum").c_str());
    const char *reason = nullptr;
    size_t offset = 0;
    TEST_ASSERT_TRUE_MESSAGE(
        zenit::proto::check_strict_object(frame.json, frame.json_length, zenit::proto::MAX_NESTING, reason, offset),
        (label + ": reply is not strict JSON").c_str());
    JsonDocument actual;
    TEST_ASSERT_FALSE_MESSAGE(deserializeJson(actual, frame.json, frame.json_length), (label + ": reply").c_str());
    // An error reply carries a message for people, which the cases do not pin down.
    if (actual["ok"].is<bool>() && !actual["ok"].as<bool>())
    {
      TEST_ASSERT_TRUE_MESSAGE(actual["message"].is<const char *>() && actual["message"].as<std::string>().size() > 0,
                               (label + ": error without a message").c_str());
    }
    std::string why;
    TEST_ASSERT_TRUE_MESSAGE(matches(step["expect"], actual, why, "$"), (label + ": " + why + " in " + body).c_str());
  }
}
} // namespace

void test_protocol_cases()
{
  std::vector<fs::path> files;
  for (const auto &entry : fs::directory_iterator(PROTOCOL))
    if (entry.path().extension() == ".json")
      files.push_back(entry.path());
  std::sort(files.begin(), files.end());
  TEST_ASSERT_GREATER_THAN(0, files.size());
  for (const fs::path &file : files)
    run_protocol_case(file);
}

int main()
{
  UNITY_BEGIN();
  RUN_TEST(test_curve);
  RUN_TEST(test_power);
  RUN_TEST(test_record);
  RUN_TEST(test_sequences);
  RUN_TEST(test_protocol_cases);
  RUN_TEST(test_hash_cases);
  RUN_TEST(test_origin_cases);
  RUN_TEST(test_wifi_cases);
  RUN_TEST(test_board_record_cases);
  RUN_TEST(test_semver_cases);
  RUN_TEST(test_manifest_cases);
  RUN_TEST(test_web_manifest_cases);
  RUN_TEST(test_web_image_cases);
  RUN_TEST(test_schedule_cases);
  RUN_TEST(test_boot_cases);
  RUN_TEST(test_http_cases);
  RUN_TEST(test_ws_message_cases);
  RUN_TEST(test_improv_cases);
  RUN_TEST(test_scan_cases);
  RUN_TEST(test_stored_settings_cases);
  return UNITY_END();
}
