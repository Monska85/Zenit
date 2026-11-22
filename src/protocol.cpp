// SPDX-License-Identifier: GPL-3.0-or-later

#include "protocol.h"

#include <ArduinoJson.h>
#include <frame.h>
#include <proto_limits.h>
#include <reply_cache.h>
#include <request.h>
#include <settings_json.h>
#include <strict_json.h>
#include <zenit_light.h>

#include <cstdio>
#include <cstring>

#include "app.h"
#include "platform.h"
#include "settings.h"

namespace protocol
{

namespace
{

using zenit::proto::Failure;

// A parsed request is a few hundred bytes at most (the line limit is 1,024); keep a margin for the tree.
constexpr int PARSE_NESTING = 8;
// The reply is built in place: the JSON goes after the room left for the frame head.
char reply_line[zenit::proto::MAX_REPLY_LINE + 1];
// The lightness of `status`, written with one decimal and handed to the serializer as it is.
char lightness_text[16];

zenit::proto::ReplyCache caches[2];
uint32_t boot_id = 0;

zenit::proto::ReplyCache &cache_of(Transport transport) { return caches[static_cast<size_t>(transport)]; }

// What `send` did with a reply.
struct Sent
{
  bool fits;   // false: the reply is longer than the reply buffer and nothing was written
  size_t size; // the line written, newline included, when it fits
};

// Serializes `doc`, frames it and writes it.
[[nodiscard]] Sent send(JsonDocument &doc, Writer write)
{
  using namespace zenit::proto;
  constexpr size_t room = MAX_REPLY_LINE - FRAME_HEAD_SIZE;
  if (measureJson(doc) > room)
    return {false, 0};
  const size_t json_length = serializeJson(doc, reply_line + FRAME_HEAD_SIZE, room + 1);
  const size_t total = seal_frame(reply_line, json_length);
  write(reply_line, total);
  return {true, total};
}

// Builds the document of an error reply in `doc`. `seq` is null when the request was not understood far enough to have
// one.
void error_reply(JsonDocument &doc, const Failure &failure, const uint32_t *seq)
{
  doc.clear();
  if (seq)
    doc["seq"] = *seq;
  doc["ok"] = false;
  doc["error"] = failure.code;
  doc["message"] = failure.message;
}

// An error reply with no `seq`, never remembered. Its text is fixed and short, so it always fits.
void send_error(const Failure &failure, Writer write)
{
  JsonDocument doc;
  error_reply(doc, failure, nullptr);
  (void)send(doc, write);
}

void send_bad_frame(const char *message, Writer write) { send_error(zenit::proto::fail("bad_frame", message), write); }

void write_light(JsonObject light)
{
  const zenit::LightStatus &status = app::last_frame().status;
  light["on"] = status.on;
  light["effect"] = zenit::effect_name(status.effect);
  if (status.lit)
    light["color"] = zenit::color_name(status.color);
  else
    light["color"] = nullptr;
  std::snprintf(lightness_text, sizeof(lightness_text), "%.1f", status.lightness);
  light["lightness"] = serialized(lightness_text);
  light["power_scale"] = status.power_scale;
  if (status.timer)
  {
    JsonObject timer = light["timer"].to<JsonObject>();
    timer["minutes"] = status.timer_minutes;
    timer["remaining"] = status.timer_remaining_s;
  }
  else
    light["timer"] = nullptr;
}

// ---- Commands ----

struct Context
{
  JsonObjectConst request;
  Transport transport;
  uint64_t now;
};

Failure cmd_info(const Context &context, JsonDocument &reply)
{
  if (Failure failure = zenit::proto::allow_only(context.request, {}))
    return failure;
  reply["protocol"] = 1;
  reply["firmware"] = platform::firmware_version();
  reply["board"] = platform::board_name();
  reply["boot_id"] = boot_id;
  JsonArray colors = reply["colors"].to<JsonArray>();
  for (size_t i = 0; i < zenit::COLOR_COUNT; i++)
    colors.add(zenit::color_name(static_cast<zenit::Color>(i)));
  JsonArray effects = reply["effects"].to<JsonArray>();
  for (size_t i = 0; i < zenit::EFFECT_COUNT; i++)
    effects.add(zenit::effect_name(static_cast<zenit::Effect>(i)));
  JsonArray sets = reply["color_sets"].to<JsonArray>();
  for (size_t i = 0; i < zenit::COLOR_SET_COUNT; i++)
    sets.add(zenit::color_set_name(static_cast<zenit::ColorSet>(i)));
  reply["power_limit_mw"] = zenit::POWER_LIMIT_MW;
  const platform::MemoryInfo memory = platform::memory_info();
  reply["memory"]["free"] = memory.free;
  reply["memory"]["largest"] = memory.largest;
  const platform::NvsInfo nvs = platform::nvs_info();
  reply["nvs"]["used"] = nvs.used;
  reply["nvs"]["free"] = nvs.free;
  reply["limits"]["line"] = zenit::proto::MAX_LINE;
  return {};
}

Failure cmd_status(const Context &context, JsonDocument &reply)
{
  if (Failure failure = zenit::proto::allow_only(context.request, {}))
    return failure;
  // Not older than this request: a change made a moment ago shows in the status already.
  app::tick(context.now);
  write_light(reply["light"].to<JsonObject>());
  return {};
}

Failure cmd_settings_get(const Context &context, JsonDocument &reply)
{
  if (Failure failure = zenit::proto::allow_only(context.request, {}))
    return failure;
  zenit::proto::write_settings(reply["settings"].to<JsonObject>(), settings::current());
  return {};
}

Failure cmd_settings_set(const Context &context, JsonDocument &reply)
{
  zenit::LightSettings next = settings::current();
  if (Failure failure = zenit::proto::apply_settings_request(context.request, next))
    return failure;
  if (app::change_settings(next, context.now) != settings::Commit::Ok)
    return zenit::proto::fail("storage_error", "the settings could not be saved; nothing changed");
  zenit::proto::write_settings(reply["settings"].to<JsonObject>(), settings::current());
  return {};
}

Failure cmd_light(const Context &context, JsonDocument &reply)
{
  if (Failure failure = zenit::proto::allow_only(context.request, {"on"}))
    return failure;
  JsonVariantConst on = context.request["on"];
  if (!on.is<bool>())
    return zenit::proto::fail("bad_request", "\"on\" must be true or false");
  app::set_light(on.as<bool>(), context.now);
  // The reply reports the light as this request left it, not as the last 10 ms tick saw it.
  app::tick(context.now);
  write_light(reply["light"].to<JsonObject>());
  return {};
}

Failure cmd_settings_reset(const Context &context, JsonDocument &reply)
{
  if (Failure failure = zenit::proto::allow_only(context.request, {}))
    return failure;
  if (context.transport != Transport::Usb)
    return zenit::proto::fail("usb_only", "this command works over USB only");
  if (app::change_settings(zenit::LightSettings(), context.now) != settings::Commit::Ok)
    return zenit::proto::fail("storage_error", "the settings could not be saved; nothing changed");
  zenit::proto::write_settings(reply["settings"].to<JsonObject>(), settings::current());
  return {};
}

struct Command
{
  const char *name;
  Failure (*run)(const Context &, JsonDocument &);
};

const Command COMMANDS[] = {
    {"info", cmd_info},
    {"status", cmd_status},
    {"settings_get", cmd_settings_get},
    {"settings_set", cmd_settings_set},
    {"light", cmd_light},
    {"settings_reset", cmd_settings_reset},
};

// A request read from a frame whose checksum matched.
struct Request
{
  JsonDocument document;
  uint32_t seq = 0;
  const char *command = nullptr; // points into `document`
};

// Strict JSON, then the parse, then `seq` and `cmd`. The failure of a request that cannot be read is `bad_frame` or
// `bad_request`, and its reply carries no `seq`.
Failure read_request(const zenit::proto::Frame &frame, Request &request)
{
  using namespace zenit::proto;
  const char *reason = nullptr;
  size_t offset = 0;
  if (!check_strict_object(frame.json, frame.json_length, MAX_NESTING, reason, offset))
  {
    char message[96];
    std::snprintf(message, sizeof(message), "not strict JSON: %s (byte %u)", reason, static_cast<unsigned>(offset));
    return fail("bad_frame", message);
  }
  if (deserializeJson(request.document, frame.json, frame.json_length,
                      DeserializationOption::NestingLimit(PARSE_NESTING)))
    return fail("bad_frame", "the JSON could not be read");
  JsonObjectConst object = request.document.as<JsonObjectConst>();
  JsonVariantConst cmd = object["cmd"];
  if (!read_seq(object, request.seq) || !cmd.is<const char *>())
    return fail("bad_request", "seq must be a whole number and cmd must be text");
  request.command = cmd.as<const char *>();
  return {};
}

// Runs the command the request names. The reply document holds `seq` and `ok`, and the command adds its fields.
Failure dispatch(const Request &request, Transport transport, uint64_t now, JsonDocument &reply)
{
  const Context context{request.document.as<JsonObjectConst>(), transport, now};
  for (const Command &command : COMMANDS)
    if (std::strcmp(request.command, command.name) == 0)
      return command.run(context, reply);
  return zenit::proto::fail("unknown_command", "this firmware does not know the command");
}

// Runs a request that arrived intact and writes its reply, or the remembered one.
void run_request(const zenit::proto::Frame &frame, Transport transport, uint64_t now, Writer write)
{
  Request request;
  if (const Failure unreadable = read_request(frame, request))
  {
    send_error(unreadable, write);
    return;
  }

  zenit::proto::ReplyCache &cache = cache_of(transport);
  size_t cached_length = 0;
  if (const char *cached = cache.find(request.seq, frame.crc, cached_length))
  {
    write(cached, cached_length);
    return;
  }

  JsonDocument reply;
  reply["seq"] = request.seq;
  reply["ok"] = true;
  if (const Failure failure = dispatch(request, transport, now, reply))
    // The fields a failed command wrote are dropped: an error reply holds `seq`, `ok`, `error` and `message`.
    error_reply(reply, failure, &request.seq);
  const Sent sent = send(reply, write);
  if (!sent.fits)
  {
    // A reply longer than the buffer cannot be built: tell the client instead of staying silent, and remember nothing.
    error_reply(reply, zenit::proto::fail("busy", "the reply does not fit"), &request.seq);
    (void)send(reply, write);
    return;
  }
  cache.store(request.seq, frame.crc, reply_line, sent.size);
}

} // namespace

void begin(uint32_t id)
{
  boot_id = id;
  for (auto &cache : caches)
    cache.clear();
}

void handle_line(Transport transport, const char *line, size_t length, uint64_t now, Writer write)
{
  using namespace zenit::proto;
  // The line is as the transport framed it: the line reader has taken off the one `\r` before the newline, and a
  // WebSocket message has none. Any other carriage return is part of the JSON, which strict JSON refuses.
  if (!has_marker(line, length))
    return;
  if (length > MAX_LINE)
  {
    send_bad_frame("the line is too long", write);
    return;
  }
  Frame frame;
  switch (parse_frame(line, length, frame))
  {
  case FrameStatus::NotProtocol:
    return;
  case FrameStatus::Malformed:
    send_bad_frame("the checksum is missing or malformed", write);
    return;
  case FrameStatus::BadCrc:
    send_bad_frame("the checksum does not match", write);
    return;
  case FrameStatus::Ok:
    run_request(frame, transport, now, write);
    return;
  }
}

void line_too_long(Transport, Writer write) { send_bad_frame("the line is too long", write); }

void wifi_opened() { cache_of(Transport::Wifi).clear(); }
void wifi_closed() { cache_of(Transport::Wifi).clear(); }

} // namespace protocol
