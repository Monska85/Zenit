// SPDX-License-Identifier: GPL-3.0-or-later

#include "protocol.h"

#include <ArduinoJson.h>
#include <frame.h>
#include <net_auth.h>
#include <proto_limits.h>
#include <reply_cache.h>
#include <request.h>
#include <settings_json.h>
#include <strict_json.h>
#include <zenit_light.h>

#include <iterator>

#include <cstdio>
#include <string>
#include <cstring>

#include "app.h"
#include "network.h"
#include "platform.h"
#include "protocol_status.h"
#include "settings.h"
#include "updates.h"

namespace protocol
{

namespace
{

using zenit::proto::Failure;

// The reply is built in place: the JSON goes after the room left for the frame head.
char reply_line[zenit::proto::MAX_REPLY_LINE + 1];

zenit::proto::ReplyCache caches[2];
uint32_t boot_id = 0;

zenit::proto::ReplyCache &cache_of(Transport transport) { return caches[static_cast<size_t>(transport)]; }

// The login of the WiFi client, and a request the last command made to close its connection.
zenit::net::AuthSession wifi_auth;
bool close_wifi_requested = false;
// Set when the command being run ended the WiFi client's login: its own reply is not remembered, so a resent copy is
// judged again (and is `unauthorized` while the login is on).
bool wifi_login_revoked = false;
// The WiFi client's connection: whether one is open, since when, and whether its login timeout has been reported.
bool wifi_connected = false;
uint64_t wifi_opened_at = 0;
bool login_timeout_reported = false;

// A new WiFi connection, or none: the remembered reply, the login and a pending close request are forgotten.
void reset_wifi_session()
{
  cache_of(Transport::Wifi).clear();
  wifi_auth.reset();
  close_wifi_requested = false;
  login_timeout_reported = false;
}

// The WiFi client's login ends now, not when its connection closes: lines already queued, and those that arrive before
// the close lands, are `unauthorized` (a new token, a reset, the login turned on). A remembered reply made before is
// forgotten too, so a resent `seq` cannot fetch it. The close is asked for, and the client logs in when it connects
// again.
void revoke_wifi_login()
{
  wifi_auth.reset();
  cache_of(Transport::Wifi).clear();
  close_wifi_requested = true;
  wifi_login_revoked = true;
}

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

// ---- Commands ----

struct Context
{
  JsonObjectConst request;
  Transport transport;
  uint64_t now;
};

Failure cmd_info(const Context &, JsonDocument &reply)
{
  reply["protocol"] = zenit::proto::PROTOCOL_VERSION;
  reply["firmware"] = platform::firmware_version();
  reply["board"] = platform::board_name();
  reply["boot_id"] = boot_id;
  JsonArray colors = reply["colors"].to<JsonArray>();
  for (size_t i = 0; i < zenit::COLOR_COUNT; i++)
    colors.add(zenit::color_name(static_cast<zenit::Color>(i)));
  JsonArray effects = reply["effects"].to<JsonArray>();
  for (size_t i = 0; i < zenit::EFFECT_COUNT; i++)
    effects.add(zenit::effect_name(static_cast<zenit::Effect>(i)));
  // What each effect reads, from the engine's own registry: the reply and the restart rule cannot drift.
  JsonObject effect_settings = reply["effect_settings"].to<JsonObject>();
  for (size_t i = 0; i < zenit::EFFECT_COUNT; i++)
  {
    const zenit::Effect effect = static_cast<zenit::Effect>(i);
    JsonArray names = effect_settings[zenit::effect_name(effect)].to<JsonArray>();
    for (const zenit::EffectSetting &setting : zenit::EFFECT_SETTINGS)
      if (zenit::effect_info(effect).params & setting.param)
        names.add(setting.name);
  }
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
  // Not older than this request: a change made a moment ago shows in the status already.
  app::tick(context.now);
  write_light(reply["light"].to<JsonObject>());
  const network::Snapshot net = network::snapshot();
  write_wifi(reply["wifi"].to<JsonObject>(), net);
  write_time(reply["time"].to<JsonObject>(), net);
  write_update(reply["update"].to<JsonObject>());
  return {};
}

Failure cmd_settings_get(const Context &context, JsonDocument &reply)
{
  zenit::proto::write_settings(reply["settings"].to<JsonObject>(), settings::current(), settings::board(),
                               context.transport == Transport::Usb);
  return {};
}

Failure cmd_settings_set(const Context &context, JsonDocument &reply)
{
  zenit::LightSettings next = settings::current();
  zenit::net::BoardSettings next_board = settings::board();
  if (Failure failure = zenit::proto::apply_settings_request(context.request, next, next_board))
    return failure;
  const bool login_turned_on = next_board.network_login && !settings::board().network_login;
  if (app::change_settings(next, next_board, context.now) != settings::Commit::Ok)
    return zenit::proto::fail("storage_error", "the settings could not be saved; nothing changed");
  // The client that turned the login on logs in when it connects again.
  if (login_turned_on)
    revoke_wifi_login();
  zenit::proto::write_settings(reply["settings"].to<JsonObject>(), settings::current(), settings::board(),
                               context.transport == Transport::Usb);
  return {};
}

Failure cmd_light(const Context &context, JsonDocument &reply)
{
  JsonVariantConst on = context.request["on"];
  if (!on.is<bool>())
    return zenit::proto::fail("bad_request", "\"on\" must be true or false");
  app::set_light(on.as<bool>(), context.now);
  // The reply reports the light as this request left it, not as the last 10 ms tick saw it.
  app::tick(context.now);
  write_light(reply["light"].to<JsonObject>());
  return {};
}

Failure usb_only(const Context &context)
{
  if (context.transport != Transport::Usb)
    return zenit::proto::fail("usb_only", "this command works over USB only");
  return {};
}

Failure cmd_settings_reset(const Context &context, JsonDocument &reply)
{
  if (Failure failure = usb_only(context))
    return failure;
  if (app::change_settings(zenit::LightSettings(), settings::fresh_board_settings(), context.now) !=
      settings::Commit::Ok)
    return zenit::proto::fail("storage_error", "the settings could not be saved; nothing changed");
  revoke_wifi_login();
  zenit::proto::write_settings(reply["settings"].to<JsonObject>(), settings::current(), settings::board(), true);
  return {};
}

Failure cmd_wifi_forget(const Context &context, JsonDocument &)
{
  if (Failure failure = usb_only(context))
    return failure;
  zenit::net::BoardSettings next = settings::board();
  next.wifi_ssid[0] = '\0';
  next.wifi_password[0] = '\0';
  if (app::change_settings(settings::current(), next, context.now) != settings::Commit::Ok)
    return zenit::proto::fail("storage_error", "the settings could not be saved; nothing changed");
  return {};
}

Failure cmd_token_regenerate(const Context &context, JsonDocument &reply)
{
  if (Failure failure = usb_only(context))
    return failure;
  zenit::net::BoardSettings next = settings::board();
  next.token[0] = '\0';
  if (app::change_settings(settings::current(), next, context.now) != settings::Commit::Ok)
    return zenit::proto::fail("storage_error", "the token could not be saved; the old one stays");
  revoke_wifi_login();
  reply["token"] = std::string(settings::board().token);
  return {};
}

Failure cmd_auth_challenge(const Context &context, JsonDocument &reply)
{
  if (context.transport != Transport::Wifi)
    return zenit::proto::fail("bad_request", "authentication is for WiFi clients");
  uint8_t random[zenit::net::NONCE_BYTES];
  platform::random_bytes(random, sizeof(random));
  reply["nonce"] = std::string(wifi_auth.challenge(random));
  return {};
}

Failure cmd_auth(const Context &context, JsonDocument &)
{
  if (context.transport != Transport::Wifi)
    return zenit::proto::fail("bad_request", "authentication is for WiFi clients");
  JsonVariantConst hmac = context.request["hmac"];
  if (!hmac.is<const char *>() || !zenit::net::is_hmac_text(hmac.as<const char *>()))
    return zenit::proto::fail("bad_request", "\"hmac\" must be 64 lowercase hexadecimal digits");
  switch (wifi_auth.attempt(settings::board().token, hmac.as<const char *>()))
  {
  case zenit::net::AuthSession::Verdict::Accepted:
    return {};
  case zenit::net::AuthSession::Verdict::Refused:
    return zenit::proto::fail("unauthorized", "the login was not accepted");
  case zenit::net::AuthSession::Verdict::RefusedAndClose:
    close_wifi_requested = true;
    return zenit::proto::fail("unauthorized", "the login was not accepted; the connection closes");
  }
  return {};
}

Failure update_failure(updates::Reply reply)
{
  switch (reply)
  {
  case updates::Reply::Ok:
    return {};
  case updates::Reply::UpdatesOff:
    return zenit::proto::fail("updates_off", "firmware updates are off");
  case updates::Reply::NoNetwork:
    return zenit::proto::fail("no_network", "the board is not connected to WiFi");
  case updates::Reply::NothingToInstall:
    return zenit::proto::fail("nothing_to_install", "the last check found nothing to install");
  case updates::Reply::Busy:
    return zenit::proto::fail("busy", "an update check or install is running");
  }
  return {};
}

Failure cmd_update_check(const Context &context, JsonDocument &reply)
{
  if (Failure failure = update_failure(updates::request_check(context.now)))
    return failure;
  write_update(reply["update"].to<JsonObject>());
  return {};
}

Failure cmd_update_install(const Context &context, JsonDocument &reply)
{
  JsonVariantConst target = context.request["target"];
  const bool is_text = target.is<const char *>();
  const bool web = is_text && std::strcmp(target.as<const char *>(), "web") == 0;
  if (!is_text || (!web && std::strcmp(target.as<const char *>(), "firmware") != 0))
    return zenit::proto::fail("bad_request", "\"target\" must be \"firmware\" or \"web\"");
  JsonVariantConst force = context.request["force"];
  if (!force.isUnbound() && !force.is<bool>())
    return zenit::proto::fail("bad_request", "\"force\" must be true or false");
  if (web && !force.isUnbound())
    return zenit::proto::fail("bad_request", "\"force\" applies to the firmware only");
  if (Failure failure = update_failure(updates::request_install(
          web ? install_target::Target::Web : install_target::Target::Firmware, force | false)))
    return failure;
  write_update(reply["update"].to<JsonObject>());
  return {};
}

// Whether a WiFi client that has not logged in may send the command (network login on).
enum class Login : bool
{
  Required,
  NotNeeded
};
// The request fields the command takes besides `seq` and `cmd`: the listed ones, any other being `bad_request`, checked
// before the command runs; or the command checks its own (`settings_set`, apply_settings_request).
enum class Fields : bool
{
  Listed,
  Own
};

struct Command
{
  const char *name;
  Failure (*run)(const Context &, JsonDocument &);
  Login login;
  Fields checked;
  const char *fields[2];
};

const Command COMMANDS[] = {
    {"info", cmd_info, Login::NotNeeded, Fields::Listed, {}},
    {"status", cmd_status, Login::Required, Fields::Listed, {}},
    {"settings_get", cmd_settings_get, Login::Required, Fields::Listed, {}},
    {"settings_set", cmd_settings_set, Login::Required, Fields::Own, {}},
    {"light", cmd_light, Login::Required, Fields::Listed, {"on"}},
    {"settings_reset", cmd_settings_reset, Login::Required, Fields::Listed, {}},
    {"wifi_forget", cmd_wifi_forget, Login::Required, Fields::Listed, {}},
    {"token_regenerate", cmd_token_regenerate, Login::Required, Fields::Listed, {}},
    {"auth_challenge", cmd_auth_challenge, Login::NotNeeded, Fields::Listed, {}},
    {"auth", cmd_auth, Login::NotNeeded, Fields::Listed, {"hmac"}},
    {"update_check", cmd_update_check, Login::Required, Fields::Listed, {}},
    {"update_install", cmd_update_install, Login::Required, Fields::Listed, {"target", "force"}},
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
                      DeserializationOption::NestingLimit(MAX_NESTING)))
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
    {
      if (transport == Transport::Wifi && settings::board().network_login && !wifi_auth.authenticated() &&
          command.login == Login::Required)
        return zenit::proto::fail("unauthorized", "log in first: auth_challenge, then auth");
      if (command.checked == Fields::Listed)
        if (Failure failure = zenit::proto::allow_only(context.request, command.fields, std::size(command.fields)))
          return failure;
      return command.run(context, reply);
    }
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
  wifi_login_revoked = false;
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
  if (!(transport == Transport::Wifi && wifi_login_revoked))
    cache.store(request.seq, frame.crc, reply_line, sent.size);
}

} // namespace

void begin(uint32_t id)
{
  boot_id = id;
  for (auto &cache : caches)
    cache.clear();
  reset_wifi_session();
  wifi_connected = false;
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

void wifi_opened(uint64_t now)
{
  reset_wifi_session();
  wifi_connected = true;
  wifi_opened_at = now;
}

void wifi_closed()
{
  reset_wifi_session();
  wifi_connected = false;
}

void poll(uint64_t now)
{
  // A client that stays unauthenticated is closed, so it cannot hold the single slot
  if (wifi_connected && !login_timeout_reported && wifi_login_pending() &&
      now - wifi_opened_at >= zenit::proto::LOGIN_WAIT_MS)
  {
    login_timeout_reported = true;
    close_wifi_requested = true;
  }
}

bool wifi_login_pending() { return settings::board().network_login && !wifi_auth.authenticated(); }

bool take_wifi_close_request()
{
  const bool requested = close_wifi_requested;
  close_wifi_requested = false;
  return requested;
}

} // namespace protocol
