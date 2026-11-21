// SPDX-License-Identifier: GPL-3.0-or-later

// Runs the cases of conformance/light against the light engine.

#include <unity.h>

#include <filesystem>
#include <string>
#include <vector>

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

int main()
{
  UNITY_BEGIN();
  RUN_TEST(test_curve);
  RUN_TEST(test_power);
  RUN_TEST(test_record);
  RUN_TEST(test_sequences);
  return UNITY_END();
}
