// SPDX-License-Identifier: GPL-3.0-or-later

// Unit tests of lib/ZenitProto and of the protocol core, beyond the conformance cases. Checksums here are the standard
// CRC-32 test values or worked out with an independent implementation (Python's zlib), never taken from the code.

#include <unity.h>

#include <frame.h>
#include <crc32.h>
#include <line_reader.h>
#include <quote.h>
#include <reply_cache.h>
#include <settings_json.h>
#include <strict_json.h>
#include <update_record.h>
#include <utf8.h>

#include <cstring>
#include <string>
#include <vector>

#include "app.h"
#include "platform.h"
#include "protocol.h"
#include "settings.h"
#include "sim_control.h"
#include "zenit_test.h"

namespace proto = zenit::proto;

void setUp()
{
  platform::sim_set_log(false);
  platform::sim_set_now_ms(0);
  settings::sim_fail_writes(false);
  settings::sim_clear();
  settings::sim_reset_current();
}
void tearDown() {}

// ---- CRC-32 and framing ----

void test_crc32_check_values()
{
  TEST_ASSERT_EQUAL_HEX32(0x00000000, proto::crc32("", 0));
  TEST_ASSERT_EQUAL_HEX32(0xE8B7BE43, proto::crc32("a", 1));
  TEST_ASSERT_EQUAL_HEX32(0xCBF43926, proto::crc32("123456789", 9));
  const char *info = "{\"seq\":1,\"cmd\":\"info\"}";
  TEST_ASSERT_EQUAL_HEX32(0x3C250228, proto::crc32(info, std::strlen(info)));
}

void test_parse_frame()
{
  const char *line = "@ZN 3c250228 {\"seq\":1,\"cmd\":\"info\"}";
  proto::Frame frame;
  TEST_ASSERT_TRUE(proto::parse_frame(line, std::strlen(line), frame) == proto::FrameStatus::Ok);
  TEST_ASSERT_EQUAL_HEX32(0x3C250228, frame.crc);
  TEST_ASSERT_EQUAL_size_t(22, frame.json_length);
  TEST_ASSERT_EQUAL_STRING_LEN("{\"seq\":1,\"cmd\":\"info\"}", frame.json, frame.json_length);
}

void test_parse_frame_rejects()
{
  proto::Frame frame;
  auto status = [&](const char *line)
  {
    return proto::parse_frame(line, std::strlen(line), frame);
  };
  TEST_ASSERT_TRUE(status("hello") == proto::FrameStatus::NotProtocol);
  TEST_ASSERT_TRUE(status("@ZN") == proto::FrameStatus::NotProtocol);
  TEST_ASSERT_TRUE(status("@zn 3c250228 {}") == proto::FrameStatus::NotProtocol);
  TEST_ASSERT_TRUE(status("@ZN ") == proto::FrameStatus::Malformed);
  TEST_ASSERT_TRUE(status("@ZN 3c250228") == proto::FrameStatus::Malformed);
  TEST_ASSERT_TRUE(status("@ZN 3c250228 ") == proto::FrameStatus::Malformed);
  TEST_ASSERT_TRUE(status("@ZN 3C250228 {\"seq\":1,\"cmd\":\"info\"}") == proto::FrameStatus::Malformed);
  TEST_ASSERT_TRUE(status("@ZN 3c25022 {\"seq\":1,\"cmd\":\"info\"}") == proto::FrameStatus::Malformed);
  TEST_ASSERT_TRUE(status("@ZN 3c250228x{\"seq\":1,\"cmd\":\"info\"}") == proto::FrameStatus::Malformed);
  TEST_ASSERT_TRUE(status("@ZN 3c250229 {\"seq\":1,\"cmd\":\"info\"}") == proto::FrameStatus::BadCrc);
}

void test_format_frame()
{
  char line[64];
  const char *json = "{\"seq\":1,\"cmd\":\"info\"}";
  const size_t size = proto::format_frame(line, sizeof(line), json, std::strlen(json));
  TEST_ASSERT_EQUAL_size_t(36, size);
  TEST_ASSERT_EQUAL_STRING_LEN("@ZN 3c250228 {\"seq\":1,\"cmd\":\"info\"}\n", line, size);
  char small[35];
  TEST_ASSERT_EQUAL_size_t(0, proto::format_frame(small, sizeof(small), json, std::strlen(json)));
}

// ---- Strict JSON ----

static bool strict(const std::string &json, int depth = 4)
{
  const char *reason = nullptr;
  size_t offset = 0;
  return proto::check_strict_object(json.data(), json.size(), depth, reason, offset);
}

void test_strict_json_accepts()
{
  TEST_ASSERT_TRUE(strict("{}"));
  TEST_ASSERT_TRUE(strict(" \t{ \"a\" : [ 1 , -2.5e+3 , true , false , null , \"x\" ] }\t "));
  TEST_ASSERT_TRUE(strict("{\"a\":\"\\u00e9\\ud83d\\ude00\\n\\/\"}"));
  TEST_ASSERT_TRUE(strict("{\"a\":\"caf\xC3\xA9 \xF0\x9F\x98\x80\"}"));
  TEST_ASSERT_TRUE(strict("{\"a\":0,\"b\":-0,\"c\":0.5,\"d\":10e2}"));
  // Four levels: the object and three nested containers.
  TEST_ASSERT_TRUE(strict("{\"a\":{\"b\":{\"c\":1}}}"));
  TEST_ASSERT_TRUE(strict("{\"a\":[[[1]]]}"));
  TEST_ASSERT_TRUE(strict("{\"a\":{\"b\":{\"c\":{}}}}"));
  // The same key in different objects is fine.
  TEST_ASSERT_TRUE(strict("{\"a\":{\"a\":1},\"b\":{\"a\":1}}"));
  TEST_ASSERT_TRUE(strict("{\"l\":[{\"a\":1},{\"a\":2}],\"a\":0}"));
  TEST_ASSERT_TRUE(strict("{\"a\":1,\"A\":2,\"a \":3}"));
  TEST_ASSERT_TRUE(strict("{\"a\":{\"x\":1},\"x\":2}"));
}

void test_strict_json_rejects()
{
  const char *bad[] = {
      "",
      "   ",
      "[]",
      "1",
      "\"a\"",
      "null",
      "{",
      "{\"a\":1",
      "{\"a\":1}{}",
      "{\"a\":1} x",
      "{\"a\":1,}",
      "{,}",
      "{\"a\" 1}",
      "{\"a\":}",
      "{a:1}",
      "{'a':1}",
      "{\"a\":'x'}",
      "{\"a\":1 // note\n}",
      "{\"a\":/* c */1}",
      "{\"a\":+1}",
      "{\"a\":01}",
      "{\"a\":1.}",
      "{\"a\":.5}",
      "{\"a\":1e}",
      "{\"a\":-}",
      "{\"a\":NaN}",
      "{\"a\":tru}",
      "{\"a\":True}",
      "{\"a\":[1,]}",
      "{\"a\":[1 2]}",
      "{\"a\":[}",
      "{\"a\":\"x\ty\"}",
      "{\"a\":\"x\ny\"}",
      "{\"a\":\"\\x\"}",
      "{\"a\":\"\\u12\"}",
      "{\"a\":\"\\u12zz\"}",
      "{\"a\":\"\\u0000\"}",
      "{\"a\":\"\\ud800\"}",
      "{\"a\":\"\\udc00\"}",
      "{\"a\":\"\\ud800\\u0041\"}",
      "{\"a\":\"\\ud83d\\ud83d\"}",
      "{\"a\":\"abc",
      "{\"a\":\"abc\\",
      "{\"a\":\"\xFF\"}",
      "{\"a\":\"\xC0\x80\"}",
      "{\"a\":\"\xED\xA0\x80\"}",
      "{\"a\":\"\xF4\x90\x80\x80\"}",
      "{\"a\":\"\xC3\"}",
      "\xEF\xBB\xBF{}",
      "{\"a\":{\"b\":{\"c\":{\"d\":{}}}}}",
      "{\"a\":[[[[1]]]]}",
      // Newlines and carriage returns are not whitespace here
      "{\"a\":1}\n",
      "{\"a\":1}\r",
      "{\"a\":1}\r\r\n",
      "{\r\"a\":1}",
      "{\"a\":\n1}",
      "{\"a\":1,\r\n\"b\":2}",
      "\n{\"a\":1}",
      // A key named twice in one object, at any level, as written or as decoded
      "{\"a\":1,\"a\":2}",
      "{\"a\":1,\"b\":2,\"a\":3}",
      "{\"a\":1,\"\\u0061\":2}",
      "{\"\\ud83d\\ude00\":1,\"\xF0\x9F\x98\x80\":2}",
      "{\"x\":{\"a\":1,\"a\":2}}",
      "{\"l\":[{\"a\":1,\"a\":1}]}",
      "{\"a\":{\"b\":1},\"a\":{}}",
  };
  for (const char *json : bad)
    TEST_ASSERT_FALSE_MESSAGE(strict(json), json);
}

void test_strict_json_refuses_more_keys_than_it_remembers()
{
  std::string many = "{";
  for (int i = 0; i < 192; i++)
    many += (i ? ",\"k" : "\"k") + std::to_string(i) + "\":0";
  TEST_ASSERT_TRUE(strict(many + "}"));
  TEST_ASSERT_FALSE(strict(many + ",\"extra\":0}"));
  // The keys of a closed object are forgotten: 300 objects in turn, one key each, are no more than one key at once.
  std::string list = "{\"l\":[{\"a\":0}";
  for (int i = 1; i < 300; i++)
    list += ",{\"a\":0}";
  TEST_ASSERT_TRUE(strict(list + "]}"));
}

void test_strict_json_rejects_raw_nul()
{
  const std::string with_nul("{\"a\":\"x\0y\"}", 11);
  TEST_ASSERT_FALSE(strict(with_nul));
}

void test_strict_json_reports_the_offset()
{
  const char *json = "{\"a\":1,}";
  const char *reason = nullptr;
  size_t offset = 0;
  TEST_ASSERT_FALSE(proto::check_strict_object(json, std::strlen(json), 4, reason, offset));
  TEST_ASSERT_EQUAL_size_t(7, offset);
  TEST_ASSERT_NOT_NULL(reason);
}

void test_utf8_sequence_length()
{
  auto length = [](const char *text)
  {
    return zenit::net::utf8_sequence_length(text, std::strlen(text), 0);
  };
  TEST_ASSERT_EQUAL_size_t(1, length("a"));
  TEST_ASSERT_EQUAL_size_t(2, length("\xC3\xA9"));
  TEST_ASSERT_EQUAL_size_t(3, length("\xE2\x82\xAC"));
  TEST_ASSERT_EQUAL_size_t(4, length("\xF0\x9F\x98\x80"));
  TEST_ASSERT_EQUAL_size_t(0, length("\x80"));
  TEST_ASSERT_EQUAL_size_t(0, length("\xC1\xBF"));
  TEST_ASSERT_EQUAL_size_t(0, length("\xE0\x80\x80"));
  TEST_ASSERT_EQUAL_size_t(0, length("\xED\xBF\xBF"));
  TEST_ASSERT_EQUAL_size_t(0, length("\xF0\x80\x80\x80"));
  TEST_ASSERT_EQUAL_size_t(0, length("\xF5\x80\x80\x80"));
  TEST_ASSERT_EQUAL_size_t(0, length("\xE2\x82"));
}

// ---- Quoting ----

static std::string quoted(const std::string &text, size_t capacity = 64)
{
  std::vector<char> out(capacity);
  const size_t length = proto::quote_text(text.data(), text.size(), out.data(), out.size());
  TEST_ASSERT_EQUAL_size_t(std::strlen(out.data()), length);
  return std::string(out.data(), length);
}

void test_quote_text()
{
  TEST_ASSERT_EQUAL_STRING("plain \xC3\xA9", quoted("plain \xC3\xA9").c_str());
  TEST_ASSERT_EQUAL_STRING("a\xEF\xBF\xBD"
                           "b",
                           quoted("a\xFF"
                                  "b")
                               .c_str());
  TEST_ASSERT_EQUAL_STRING("\xEF\xBF\xBD\xEF\xBF\xBD", quoted("\xE2\x82").c_str());
  TEST_ASSERT_EQUAL_STRING("a\\u0001b\\u000ac\\u007f", quoted("a\x01"
                                                              "b\n"
                                                              "c\x7F")
                                                           .c_str());
  TEST_ASSERT_EQUAL_STRING("", quoted("").c_str());
}

void test_quote_text_cuts_whole_characters()
{
  // Room for 5 bytes: "ab" and the 3-byte euro sign fit, the next 2-byte character does not.
  TEST_ASSERT_EQUAL_STRING("ab\xE2\x82\xAC", quoted("ab\xE2\x82\xAC\xC3\xA9", 6).c_str());
  // An escape is 6 bytes and is never cut.
  TEST_ASSERT_EQUAL_STRING("ab", quoted("ab\x01", 7).c_str());
  TEST_ASSERT_EQUAL_STRING("ab\\u0001", quoted("ab\x01", 9).c_str());
  TEST_ASSERT_EQUAL_STRING("", quoted("abc", 1).c_str());
}

// ---- Line reader ----

namespace
{
using Event = proto::LineReader::Event;

Event feed_all(proto::LineReader &reader, const std::string &bytes, std::string *line = nullptr)
{
  Event last = Event::None;
  for (char c : bytes)
  {
    Event event = reader.feed(static_cast<uint8_t>(c));
    if (event != Event::None)
    {
      last = event;
      if (event == Event::Line && line)
        *line = std::string(reader.line(), reader.length());
    }
  }
  return last;
}
} // namespace

void test_line_reader_lines()
{
  proto::LineReader reader;
  std::string line;
  TEST_ASSERT_TRUE(feed_all(reader, "@ZN abc\n", &line) == Event::Line);
  TEST_ASSERT_EQUAL_STRING("@ZN abc", line.c_str());
  TEST_ASSERT_TRUE(feed_all(reader, "@ZN abc\r\n", &line) == Event::Line);
  TEST_ASSERT_EQUAL_STRING("@ZN abc", line.c_str());
  TEST_ASSERT_TRUE(feed_all(reader, "\n", &line) == Event::Line);
  TEST_ASSERT_EQUAL_size_t(0, line.size());
  TEST_ASSERT_TRUE(feed_all(reader, "a\r\r\n", &line) == Event::Line);
  TEST_ASSERT_EQUAL_STRING("a\r", line.c_str());
}

void test_line_reader_without_the_carriage_return_strip()
{
  proto::LineReader reader(false);
  std::string line;
  TEST_ASSERT_TRUE(feed_all(reader, "@ZN abc\r\n", &line) == Event::Line);
  TEST_ASSERT_EQUAL_STRING("@ZN abc\r", line.c_str());
}

void test_line_reader_limit()
{
  proto::LineReader reader;
  std::string line;
  const std::string head = "@ZN ";
  // Exactly the limit passes, with or without the carriage return.
  TEST_ASSERT_TRUE(feed_all(reader, head + std::string(proto::MAX_LINE - head.size(), 'x') + "\n", &line) ==
                   Event::Line);
  TEST_ASSERT_EQUAL_size_t(proto::MAX_LINE, line.size());
  TEST_ASSERT_TRUE(feed_all(reader, head + std::string(proto::MAX_LINE - head.size(), 'x') + "\r\n", &line) ==
                   Event::Line);
  TEST_ASSERT_EQUAL_size_t(proto::MAX_LINE, line.size());
  // One byte more is too long, and only a marker line is reported.
  TEST_ASSERT_TRUE(feed_all(reader, head + std::string(proto::MAX_LINE + 1 - head.size(), 'x') + "\n") ==
                   Event::TooLong);
  TEST_ASSERT_TRUE(feed_all(reader, head + std::string(5000, 'x') + "\n") == Event::TooLong);
  TEST_ASSERT_TRUE(feed_all(reader, std::string(5000, 'x') + "\n") == Event::None);
  // The line after a dropped one is read normally.
  TEST_ASSERT_TRUE(feed_all(reader, "@ZN ok\n", &line) == Event::Line);
  TEST_ASSERT_EQUAL_STRING("@ZN ok", line.c_str());
}

// ---- Reply cache ----

void test_reply_cache()
{
  proto::ReplyCache cache;
  size_t length = 0;
  TEST_ASSERT_NULL(cache.find(1, 2, length));
  TEST_ASSERT_TRUE(cache.store(1, 2, "reply\n", 6));
  const char *found = cache.find(1, 2, length);
  TEST_ASSERT_NOT_NULL(found);
  TEST_ASSERT_EQUAL_size_t(6, length);
  TEST_ASSERT_EQUAL_STRING_LEN("reply\n", found, 6);
  TEST_ASSERT_NULL(cache.find(1, 3, length));
  TEST_ASSERT_NULL(cache.find(2, 2, length));
  // Only the last reply is kept.
  TEST_ASSERT_TRUE(cache.store(5, 6, "other\n", 6));
  TEST_ASSERT_NULL(cache.find(1, 2, length));
  TEST_ASSERT_NOT_NULL(cache.find(5, 6, length));
  cache.clear();
  TEST_ASSERT_NULL(cache.find(5, 6, length));
  const std::string huge(proto::MAX_REPLY_LINE + 2, 'x');
  TEST_ASSERT_FALSE(cache.store(7, 8, huge.data(), huge.size()));
  TEST_ASSERT_NULL(cache.find(7, 8, length));
}

// ---- Settings as JSON ----

namespace
{
proto::Failure apply(const char *json, zenit::LightSettings &settings)
{
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, json));
  zenit::net::BoardSettings board;
  return proto::apply_settings_request(doc.as<JsonObjectConst>(), settings, board);
}
} // namespace

void test_settings_request_accepts_every_boundary()
{
  zenit::LightSettings s;
  TEST_ASSERT_FALSE(apply("{\"seq\":1,\"cmd\":\"settings_set\",\"brightness\":1,\"hold_seconds\":600,"
                          "\"period_seconds\":4,\"floor\":80,\"twinkle_strength\":5,\"timer_minutes\":360}",
                          s));
  TEST_ASSERT_EQUAL_UINT8(1, s.brightness);
  TEST_ASSERT_EQUAL_UINT16(600, s.hold_seconds);
  TEST_ASSERT_EQUAL_UINT8(4, s.period_seconds);
  TEST_ASSERT_EQUAL_UINT8(80, s.floor);
  TEST_ASSERT_EQUAL_UINT8(5, s.twinkle_strength);
  TEST_ASSERT_EQUAL_UINT16(360, s.timer_minutes);
  TEST_ASSERT_FALSE(apply("{\"brightness\":100,\"hold_seconds\":5,\"period_seconds\":20,\"floor\":5,"
                          "\"twinkle_strength\":50,\"timer_minutes\":0}",
                          s));
  TEST_ASSERT_EQUAL_UINT8(100, s.brightness);
  TEST_ASSERT_EQUAL_UINT16(0, s.timer_minutes);
  TEST_ASSERT_FALSE(apply("{\"colors\":[\"blue\",\"white\"],\"effect\":\"fall_asleep\",\"color\":\"green\","
                          "\"color_set\":\"ice\"}",
                          s));
  TEST_ASSERT_EQUAL_UINT8(2, s.colors.count);
  TEST_ASSERT_TRUE(s.effect == zenit::Effect::FallAsleep);
  TEST_ASSERT_TRUE(s.color == zenit::Color::Green);
  TEST_ASSERT_TRUE(s.color_set == zenit::ColorSet::Ice);
}

void test_settings_request_rejects_and_keeps_the_settings()
{
  const char *bad[] = {
      "{}",
      "{\"seq\":1}",
      "{\"brightness\":0}",
      "{\"brightness\":101}",
      "{\"brightness\":-1}",
      "{\"brightness\":60.0}",
      "{\"brightness\":6e1}",
      "{\"brightness\":\"60\"}",
      "{\"brightness\":null}",
      "{\"brightness\":true}",
      "{\"brightness\":[60]}",
      "{\"brightness\":4294967356}",
      "{\"hold_seconds\":4}",
      "{\"hold_seconds\":601}",
      "{\"period_seconds\":3}",
      "{\"period_seconds\":21}",
      "{\"floor\":4}",
      "{\"floor\":81}",
      "{\"twinkle_strength\":4}",
      "{\"twinkle_strength\":51}",
      "{\"timer_minutes\":361}",
      "{\"timer_minutes\":-1}",
      "{\"effect\":\"disco\"}",
      "{\"effect\":null}",
      "{\"effect\":1}",
      "{\"color\":\"pink\"}",
      "{\"color\":\"White\"}",
      "{\"color_set\":\"summer\"}",
      "{\"colors\":[\"red\"]}",
      "{\"colors\":[\"red\",\"green\",\"blue\",\"white\",\"red\"]}",
      "{\"colors\":[\"red\",\"red\"]}",
      "{\"colors\":[\"red\",\"pink\"]}",
      "{\"colors\":[\"red\",1]}",
      "{\"colors\":\"red,green\"}",
      "{\"colors\":null}",
      "{\"token\":\"abcdefghij012345\"}",
      "{\"unknown\":1}",
      "{\"brightness\":50,\"floor\":4}",
      "{\"brightness\":50,\"unknown\":1}",
  };
  for (const char *json : bad)
  {
    zenit::LightSettings s;
    s.brightness = 33;
    const proto::Failure failure = apply(json, s);
    TEST_ASSERT_NOT_NULL_MESSAGE(failure.code, json);
    TEST_ASSERT_EQUAL_STRING_MESSAGE("bad_request", failure.code, json);
    TEST_ASSERT_TRUE_MESSAGE(failure.message[0] != '\0', json);
    TEST_ASSERT_EQUAL_UINT8_MESSAGE(33, s.brightness, json);
    TEST_ASSERT_TRUE_MESSAGE(s.effect == zenit::Effect::Static, json);
  }
}

void test_write_settings_defaults()
{
  JsonDocument doc;
  proto::write_settings(doc.to<JsonObject>(), zenit::LightSettings(), zenit::net::BoardSettings(), false);
  std::string out;
  serializeJson(doc, out);
  TEST_ASSERT_EQUAL_STRING(
      "{\"brightness\":60,\"effect\":\"static\",\"color\":\"white\","
      "\"colors\":[\"red\",\"green\",\"blue\",\"white\"],\"color_set\":\"christmas\","
      "\"hold_seconds\":30,\"period_seconds\":8,\"floor\":20,\"twinkle_strength\":20,"
      "\"timer_minutes\":0,\"wifi_power\":\"auto\",\"update_mode\":\"automatic\","
      "\"update_firmware\":true,\"update_web\":true,\"check_hours\":6,\"install_start\":0,\"install_end\":0,"
      "\"timezone\":\"UTC0\",\"time_sync_hours\":6,\"ntp_server\":\"pool.ntp.org\","
      "\"network_login\":false}",
      out.c_str());
}

// ---- The protocol core ----

namespace
{
std::vector<std::string> written;

void capture(const char *line, size_t length)
{
  TEST_ASSERT_TRUE(length > 0 && line[length - 1] == '\n');
  written.emplace_back(line, length - 1);
}

std::string framed(const std::string &json)
{
  char line[2048];
  const size_t size = proto::format_frame(line, sizeof(line), json.data(), json.size());
  return std::string(line, size - 1);
}

void send(const std::string &line, protocol::Transport transport = protocol::Transport::Usb, uint64_t now = 0)
{
  protocol::handle_line(transport, line.data(), line.size(), now, capture);
}

// The JSON of the n-th written line, after checking its marker and checksum.
JsonDocument reply(size_t n)
{
  TEST_ASSERT_TRUE(n < written.size());
  proto::Frame frame;
  const std::string &line = written[n];
  TEST_ASSERT_TRUE(proto::parse_frame(line.data(), line.size(), frame) == proto::FrameStatus::Ok);
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, frame.json, frame.json_length));
  return doc;
}

void start()
{
  written.clear();
  settings::sim_clear();
  settings::sim_reset_current();
  platform::sim_set_now_ms(0);
  app::begin(0, 1);
  app::tick(0);
  protocol::begin(77);
}
} // namespace

void test_core_ignores_lines_without_the_marker()
{
  start();
  send("hello");
  send("zenit: log line");
  send("");
  send("@ZN");
  send(" @ZN 3c250228 {\"seq\":1,\"cmd\":\"info\"}");
  TEST_ASSERT_EQUAL_size_t(0, written.size());
}

void test_core_answers_info_with_the_limits()
{
  start();
  send(framed("{\"seq\":1,\"cmd\":\"info\"}"));
  TEST_ASSERT_EQUAL_size_t(1, written.size());
  JsonDocument doc = reply(0);
  TEST_ASSERT_EQUAL_UINT32(1, doc["seq"].as<uint32_t>());
  TEST_ASSERT_TRUE(doc["ok"].as<bool>());
  TEST_ASSERT_EQUAL_INT(1, doc["protocol"].as<int>());
  TEST_ASSERT_EQUAL_STRING("simulator", doc["board"].as<const char *>());
  TEST_ASSERT_EQUAL_UINT32(77, doc["boot_id"].as<uint32_t>());
  TEST_ASSERT_EQUAL_UINT32(1000, doc["power_limit_mw"].as<uint32_t>());
  TEST_ASSERT_EQUAL_UINT32(1024, doc["limits"]["line"].as<uint32_t>());
  TEST_ASSERT_EQUAL_size_t(4, doc["colors"].size());
  TEST_ASSERT_EQUAL_size_t(6, doc["effects"].size());
  TEST_ASSERT_EQUAL_size_t(2, doc["color_sets"].size());
}

void test_core_repeated_request_runs_once()
{
  start();
  const std::string set = framed("{\"seq\":4,\"cmd\":\"settings_set\",\"brightness\":40}");
  send(set);
  // The same request again, after something else changed the settings: the remembered reply comes back and the command
  // does not run again.
  zenit::LightSettings other = settings::current();
  other.brightness = 90;
  settings::commit(other);
  send(set);
  TEST_ASSERT_EQUAL_size_t(2, written.size());
  TEST_ASSERT_EQUAL_STRING(written[0].c_str(), written[1].c_str());
  TEST_ASSERT_EQUAL_UINT8(90, settings::current().brightness);
}

void test_core_same_seq_other_body_is_a_new_request()
{
  start();
  send(framed("{\"seq\":4,\"cmd\":\"settings_set\",\"brightness\":40}"));
  send(framed("{\"seq\":4,\"cmd\":\"settings_set\",\"brightness\":50}"));
  TEST_ASSERT_EQUAL_UINT8(50, settings::current().brightness);
  TEST_ASSERT_EQUAL_INT(50, reply(1)["settings"]["brightness"].as<int>());
}

void test_core_each_transport_has_its_own_cache()
{
  start();
  const std::string info = framed("{\"seq\":9,\"cmd\":\"info\"}");
  send(info, protocol::Transport::Usb);
  send(framed("{\"seq\":9,\"cmd\":\"status\"}"), protocol::Transport::Wifi);
  // The USB cache still holds `info`: a repeat of it is answered from there.
  send(info, protocol::Transport::Usb);
  TEST_ASSERT_EQUAL_STRING(written[0].c_str(), written[2].c_str());
  TEST_ASSERT_TRUE(written[1] != written[0]);
}

void test_core_wifi_cache_is_forgotten_when_a_connection_opens_or_closes()
{
  start();
  const std::string set = framed("{\"seq\":4,\"cmd\":\"settings_set\",\"brightness\":40}");
  send(set, protocol::Transport::Wifi);
  protocol::wifi_opened(0);
  zenit::LightSettings other = settings::current();
  other.brightness = 90;
  settings::commit(other);
  send(set, protocol::Transport::Wifi);
  TEST_ASSERT_EQUAL_UINT8(40, settings::current().brightness);
  protocol::wifi_closed();
  other.brightness = 91;
  settings::commit(other);
  send(set, protocol::Transport::Wifi);
  TEST_ASSERT_EQUAL_UINT8(40, settings::current().brightness);
}

void test_core_bad_frame_keeps_the_remembered_reply()
{
  start();
  const std::string info = framed("{\"seq\":3,\"cmd\":\"info\"}");
  send(info);
  send("@ZN 00000000 {\"seq\":3,\"cmd\":\"info\"}");
  send(info);
  TEST_ASSERT_EQUAL_size_t(3, written.size());
  TEST_ASSERT_EQUAL_STRING("bad_frame", reply(1)["error"].as<const char *>());
  TEST_ASSERT_TRUE(reply(1)["seq"].isNull());
  TEST_ASSERT_FALSE(reply(1)["ok"].as<bool>());
  TEST_ASSERT_EQUAL_STRING(written[0].c_str(), written[2].c_str());
}

void test_core_errors_have_no_seq_when_the_request_has_none()
{
  start();
  send(framed("{\"cmd\":\"info\"}"));
  send(framed("{\"seq\":-1,\"cmd\":\"info\"}"));
  send(framed("{\"seq\":4294967296,\"cmd\":\"info\"}"));
  send(framed("{\"seq\":1.5,\"cmd\":\"info\"}"));
  send(framed("{\"seq\":\"1\",\"cmd\":\"info\"}"));
  send(framed("{\"seq\":1}"));
  send(framed("{\"seq\":1,\"cmd\":5}"));
  TEST_ASSERT_EQUAL_size_t(7, written.size());
  for (size_t i = 0; i < written.size(); i++)
  {
    JsonDocument doc = reply(i);
    TEST_ASSERT_EQUAL_STRING("bad_request", doc["error"].as<const char *>());
    TEST_ASSERT_TRUE(doc["seq"].isNull());
  }
  send(framed("{\"seq\":4294967295,\"cmd\":\"info\"}"));
  TEST_ASSERT_EQUAL_UINT32(4294967295u, reply(7)["seq"].as<uint32_t>());
  send(framed("{\"seq\":0,\"cmd\":\"info\"}"));
  TEST_ASSERT_EQUAL_UINT32(0, reply(8)["seq"].as<uint32_t>());
}

void test_core_line_limit()
{
  start();
  const std::string head = "@ZN 00000000 ";
  send(head + std::string(proto::MAX_LINE, 'x'));
  TEST_ASSERT_EQUAL_STRING("bad_frame", reply(0)["error"].as<const char *>());
  send("not a protocol line " + std::string(proto::MAX_LINE, 'x'));
  TEST_ASSERT_EQUAL_size_t(1, written.size());
  protocol::line_too_long(protocol::Transport::Usb, capture);
  TEST_ASSERT_EQUAL_STRING("bad_frame", reply(1)["error"].as<const char *>());
}

// A line as a serial port delivers it: through the line reader, one byte at a time, then to the core.
static void send_through_reader(const std::string &bytes)
{
  proto::LineReader reader;
  for (char c : bytes)
  {
    const auto event = reader.feed(static_cast<uint8_t>(c));
    if (event == proto::LineReader::Event::Line)
      protocol::handle_line(protocol::Transport::Usb, reader.line(), reader.length(), 0, capture);
    else if (event == proto::LineReader::Event::TooLong)
      protocol::line_too_long(protocol::Transport::Usb, capture);
  }
}

void test_core_only_one_carriage_return_before_the_newline_is_ignored()
{
  start();
  const std::string good = framed("{\"seq\":1,\"cmd\":\"info\"}");
  send_through_reader(good + "\r\n");
  TEST_ASSERT_EQUAL_size_t(1, written.size());
  TEST_ASSERT_TRUE(reply(0)["ok"].as<bool>());
  // Two carriage returns: one stays in the line, and the line is broken whatever its checksum covers.
  send_through_reader(good + "\r\r\n");
  TEST_ASSERT_EQUAL_STRING("bad_frame", reply(1)["error"].as<const char *>());
  const std::string json = "{\"seq\":1,\"cmd\":\"info\"}\r";
  char line[128];
  const size_t size = proto::format_frame(line, sizeof(line), json.data(), json.size());
  send_through_reader(std::string(line, size - 1) + "\r\n");
  TEST_ASSERT_EQUAL_STRING("bad_frame", reply(2)["error"].as<const char *>());
  TEST_ASSERT_TRUE(std::string(reply(2)["message"].as<const char *>()).find("not strict JSON") != std::string::npos);
  // The core itself takes the line as it is given: a carriage return at its end is part of the JSON.
  send(good + "\r");
  TEST_ASSERT_EQUAL_STRING("bad_frame", reply(3)["error"].as<const char *>());
}

void test_core_a_newline_or_carriage_return_inside_the_json_is_bad_frame()
{
  start();
  for (const char *inside : {"{\"seq\":1,\r\"cmd\":\"info\"}", "{\"seq\":1,\n\"cmd\":\"info\"}"})
    send(framed(inside), protocol::Transport::Wifi);
  TEST_ASSERT_EQUAL_size_t(2, written.size());
  for (size_t i = 0; i < 2; i++)
    TEST_ASSERT_EQUAL_STRING("bad_frame", reply(i)["error"].as<const char *>());
}

void test_core_duplicate_keys_are_bad_frame_and_run_nothing()
{
  start();
  send(framed("{\"seq\":1,\"cmd\":\"info\",\"cmd\":\"settings_reset\"}"));
  send(framed("{\"seq\":2,\"cmd\":\"settings_set\",\"brightness\":10,\"brightness\":20}"));
  send(framed("{\"seq\":3,\"cmd\":\"settings_set\",\"brightness\":10,\"bright\\u006eess\":20}"));
  TEST_ASSERT_EQUAL_size_t(3, written.size());
  for (size_t i = 0; i < 3; i++)
  {
    TEST_ASSERT_EQUAL_STRING("bad_frame", reply(i)["error"].as<const char *>());
    TEST_ASSERT_TRUE(reply(i)["seq"].isNull());
  }
  TEST_ASSERT_EQUAL_UINT8(60, settings::current().brightness);
}

void test_core_unknown_command_and_fields()
{
  start();
  send(framed("{\"seq\":1,\"cmd\":\"fly\"}"));
  send(framed("{\"seq\":2,\"cmd\":\"info\",\"extra\":1}"));
  send(framed("{\"seq\":3,\"cmd\":\"light\",\"on\":true,\"extra\":1}"));
  send(framed("{\"seq\":4,\"cmd\":\"light\"}"));
  send(framed("{\"seq\":5,\"cmd\":\"light\",\"on\":null}"));
  send(framed("{\"seq\":6,\"cmd\":\"light\",\"on\":1}"));
  TEST_ASSERT_EQUAL_STRING("unknown_command", reply(0)["error"].as<const char *>());
  for (size_t i = 1; i < 6; i++)
    TEST_ASSERT_EQUAL_STRING("bad_request", reply(i)["error"].as<const char *>());
}

void test_core_quotes_request_text_in_the_error()
{
  start();
  send(framed("{\"seq\":1,\"cmd\":\"info\",\"a\\u0001b\\ud83d\\ude00\":1}"));
  TEST_ASSERT_EQUAL_size_t(1, written.size());
  JsonDocument doc = reply(0);
  TEST_ASSERT_EQUAL_STRING("bad_request", doc["error"].as<const char *>());
  const std::string message = doc["message"].as<const char *>();
  TEST_ASSERT_TRUE(message.find("a\\u0001b\xF0\x9F\x98\x80") != std::string::npos);
  for (char c : written[0].substr(0, written[0].size()))
    TEST_ASSERT_TRUE(static_cast<unsigned char>(c) >= 0x20);
}

void test_core_strict_json_failures_are_bad_frame()
{
  start();
  send(framed("{\"seq\":1,\"cmd\":\"info\",}"));
  send(framed("[1]"));
  send(framed("{\"seq\":1,\"cmd\":\"info\"} x"));
  send(framed("{\"seq\":1,\"cmd\":\"info\",\"a\":{\"b\":{\"c\":{\"d\":{}}}}}"));
  TEST_ASSERT_EQUAL_size_t(4, written.size());
  for (size_t i = 0; i < written.size(); i++)
  {
    TEST_ASSERT_EQUAL_STRING("bad_frame", reply(i)["error"].as<const char *>());
    TEST_ASSERT_TRUE(reply(i)["seq"].isNull());
  }
}

void test_core_failed_save_changes_nothing_and_answers_storage_error()
{
  start();
  send(framed("{\"seq\":1,\"cmd\":\"settings_set\",\"brightness\":40}"));
  TEST_ASSERT_TRUE(reply(0)["ok"].as<bool>());
  settings::sim_fail_writes(true);
  send(framed("{\"seq\":2,\"cmd\":\"settings_set\",\"brightness\":50}"));
  TEST_ASSERT_EQUAL_STRING("storage_error", reply(1)["error"].as<const char *>());
  TEST_ASSERT_EQUAL_UINT8(40, settings::current().brightness);
  send(framed("{\"seq\":3,\"cmd\":\"settings_reset\"}"));
  TEST_ASSERT_EQUAL_STRING("storage_error", reply(2)["error"].as<const char *>());
  TEST_ASSERT_EQUAL_UINT8(40, settings::current().brightness);
}

void test_core_settings_reset_is_usb_only()
{
  start();
  send(framed("{\"seq\":1,\"cmd\":\"settings_set\",\"brightness\":40}"));
  send(framed("{\"seq\":2,\"cmd\":\"settings_reset\"}"), protocol::Transport::Wifi);
  TEST_ASSERT_EQUAL_STRING("usb_only", reply(1)["error"].as<const char *>());
  TEST_ASSERT_EQUAL_UINT8(40, settings::current().brightness);
  send(framed("{\"seq\":3,\"cmd\":\"settings_reset\"}"), protocol::Transport::Usb);
  TEST_ASSERT_TRUE(reply(2)["ok"].as<bool>());
  TEST_ASSERT_EQUAL_UINT8(60, settings::current().brightness);
}

void test_core_light_reply_reflects_the_request()
{
  start();
  send(framed("{\"seq\":1,\"cmd\":\"light\",\"on\":false}"), protocol::Transport::Usb, 2000);
  JsonDocument doc = reply(0);
  TEST_ASSERT_FALSE(doc["light"]["on"].as<bool>());
  send(framed("{\"seq\":2,\"cmd\":\"light\",\"on\":true}"), protocol::Transport::Usb, 3000);
  TEST_ASSERT_TRUE(reply(1)["light"]["on"].as<bool>());
}

void test_core_status_lightness_has_one_decimal()
{
  start();
  send(framed("{\"seq\":1,\"cmd\":\"status\"}"), protocol::Transport::Usb, 0);
  send(framed("{\"seq\":2,\"cmd\":\"status\"}"), protocol::Transport::Usb, 500);
  send(framed("{\"seq\":3,\"cmd\":\"status\"}"), protocol::Transport::Usb, 1000);
  TEST_ASSERT_TRUE(written[0].find("\"lightness\":0.0,") != std::string::npos);
  TEST_ASSERT_TRUE(written[1].find("\"lightness\":30.0,") != std::string::npos);
  TEST_ASSERT_TRUE(written[2].find("\"lightness\":60.0,") != std::string::npos);
}

void test_core_longest_reply_fits()
{
  start();
  // Every setting at its longest value.
  send(framed("{\"seq\":4294967295,\"cmd\":\"settings_set\",\"brightness\":100,\"effect\":\"fall_asleep\","
              "\"color\":\"green\",\"colors\":[\"green\",\"white\",\"blue\",\"red\"],\"color_set\":\"christmas\","
              "\"hold_seconds\":600,\"period_seconds\":20,\"floor\":80,\"twinkle_strength\":50,"
              "\"timer_minutes\":360}"));
  TEST_ASSERT_TRUE(reply(0)["ok"].as<bool>());
  TEST_ASSERT_TRUE(written[0].size() < zenit::proto::MAX_REPLY_LINE);
  send(framed("{\"seq\":1,\"cmd\":\"info\"}"));
  TEST_ASSERT_TRUE(written[1].size() < 900);
}

void test_core_longest_settings_reply_fits()
{
  start();
  // The light at its longest, and the board settings whose text grows the most: 64 quotes for the time zone (each
  // escaped to two characters), a 64-character NTP server, the update window and the token.
  const std::string quotes(64, '"');
  std::string timezone;
  for (char c : quotes)
    timezone += std::string("\\") + c;
  const std::string server(64, 'n');
  send(framed("{\"seq\":4294967295,\"cmd\":\"settings_set\",\"brightness\":100,\"effect\":\"fall_asleep\","
              "\"color\":\"green\",\"colors\":[\"green\",\"white\",\"blue\",\"red\"],\"hold_seconds\":600,"
              "\"period_seconds\":20,\"floor\":80,\"twinkle_strength\":50,\"timer_minutes\":360,"
              "\"wifi_power\":\"auto\",\"update_mode\":\"automatic\",\"check_hours\":168,\"install_start\":1439,"
              "\"install_end\":1438,\"time_sync_hours\":168,\"timezone\":\"" +
              timezone + "\",\"ntp_server\":\"" + server + "\"}"));
  JsonDocument doc = reply(0);
  TEST_ASSERT_TRUE(doc["ok"].as<bool>());
  TEST_ASSERT_EQUAL_STRING(quotes.c_str(), doc["settings"]["timezone"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING(server.c_str(), doc["settings"]["ntp_server"].as<const char *>());
  TEST_ASSERT_TRUE(written[0].size() < zenit::proto::MAX_REPLY_LINE);
}

void test_core_longest_status_reply_fits()
{
  start();
  uint64_t now = 0;
  auto run_to = [&](uint64_t until)
  {
    for (now += zenit::TICK_MS; now <= until; now += zenit::TICK_MS)
    {
      platform::sim_set_now_ms(now);
      app::tick(now);
      app::service(now);
      sim_control::after_step(now);
    }
    now = until;
  };
  // A name of 32 quotes, the longest address and signal, a web image and a web offer with 16-character versions, a
  // firmware offer with a 20-character release, a running countdown and a time.
  const std::string ssid(32, '"');
  TEST_ASSERT_TRUE(sim_control::handle("!store-wifi ssid=" + ssid + " password=correct-horse", now));
  TEST_ASSERT_TRUE(sim_control::handle(
      "!net state=connected ssid=" + ssid + " rssi=-100 ip=255.255.255.255 synced=1 epoch=4102444799", now));
  TEST_ASSERT_TRUE(sim_control::handle("!www load 99999.99999.9998 1 1", now));
  TEST_ASSERT_TRUE(sim_control::handle("!update web publish 99999.99999.9999 1 1", now));
  TEST_ASSERT_TRUE(
      sim_control::handle("!update manifest {\"schema\":1,\"board\":\"esp32c3\",\"version\":\"999999.999999.999999\","
                          "\"file\":\"zenit-esp32c3-firmware.bin\",\"size\":65536,\"sha256\":"
                          "\"de2f256064a0af797747c2b97505dc0b9f3df0de4f489eac731c23ae9ca9cc31\"}",
                          now));
  send(framed("{\"seq\":1,\"cmd\":\"settings_set\",\"update_mode\":\"notify\",\"timer_minutes\":360,"
              "\"effect\":\"color_change\"}"),
       protocol::Transport::Usb, now);
  send(framed("{\"seq\":2,\"cmd\":\"update_check\"}"), protocol::Transport::Usb, now);
  run_to(2000);
  send(framed("{\"seq\":4294967295,\"cmd\":\"status\"}"), protocol::Transport::Usb, now);
  JsonDocument doc = reply(written.size() - 1);
  TEST_ASSERT_TRUE(doc["ok"].as<bool>());
  TEST_ASSERT_EQUAL_STRING(ssid.c_str(), doc["wifi"]["ssid"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("999999.999999.999999", doc["update"]["available"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("99999.99999.9998", doc["update"]["web"]["version"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("99999.99999.9999", doc["update"]["web"]["available"].as<const char *>());
  // `skipped` and `rolled_back` are null here; each can grow by at most a release of 20 characters and its quotes.
  TEST_ASSERT_TRUE(written.back().size() + 2 * (zenit::update::RECORD_VERSION_TEXT + 2) < zenit::proto::MAX_REPLY_LINE);
}

int main()
{
  UNITY_BEGIN();
  RUN_TEST(test_crc32_check_values);
  RUN_TEST(test_parse_frame);
  RUN_TEST(test_parse_frame_rejects);
  RUN_TEST(test_format_frame);
  RUN_TEST(test_strict_json_accepts);
  RUN_TEST(test_strict_json_rejects);
  RUN_TEST(test_strict_json_refuses_more_keys_than_it_remembers);
  RUN_TEST(test_strict_json_rejects_raw_nul);
  RUN_TEST(test_strict_json_reports_the_offset);
  RUN_TEST(test_utf8_sequence_length);
  RUN_TEST(test_quote_text);
  RUN_TEST(test_quote_text_cuts_whole_characters);
  RUN_TEST(test_line_reader_lines);
  RUN_TEST(test_line_reader_without_the_carriage_return_strip);
  RUN_TEST(test_line_reader_limit);
  RUN_TEST(test_reply_cache);
  RUN_TEST(test_settings_request_accepts_every_boundary);
  RUN_TEST(test_settings_request_rejects_and_keeps_the_settings);
  RUN_TEST(test_write_settings_defaults);
  RUN_TEST(test_core_ignores_lines_without_the_marker);
  RUN_TEST(test_core_answers_info_with_the_limits);
  RUN_TEST(test_core_repeated_request_runs_once);
  RUN_TEST(test_core_same_seq_other_body_is_a_new_request);
  RUN_TEST(test_core_each_transport_has_its_own_cache);
  RUN_TEST(test_core_wifi_cache_is_forgotten_when_a_connection_opens_or_closes);
  RUN_TEST(test_core_bad_frame_keeps_the_remembered_reply);
  RUN_TEST(test_core_errors_have_no_seq_when_the_request_has_none);
  RUN_TEST(test_core_line_limit);
  RUN_TEST(test_core_only_one_carriage_return_before_the_newline_is_ignored);
  RUN_TEST(test_core_a_newline_or_carriage_return_inside_the_json_is_bad_frame);
  RUN_TEST(test_core_duplicate_keys_are_bad_frame_and_run_nothing);
  RUN_TEST(test_core_unknown_command_and_fields);
  RUN_TEST(test_core_quotes_request_text_in_the_error);
  RUN_TEST(test_core_strict_json_failures_are_bad_frame);
  RUN_TEST(test_core_failed_save_changes_nothing_and_answers_storage_error);
  RUN_TEST(test_core_settings_reset_is_usb_only);
  RUN_TEST(test_core_light_reply_reflects_the_request);
  RUN_TEST(test_core_status_lightness_has_one_decimal);
  RUN_TEST(test_core_longest_reply_fits);
  RUN_TEST(test_core_longest_settings_reply_fits);
  RUN_TEST(test_core_longest_status_reply_fits);
  return UNITY_END();
}
