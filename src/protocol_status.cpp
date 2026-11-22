// SPDX-License-Identifier: GPL-3.0-or-later

#include "protocol_status.h"

#include <quote.h>
#include <zenit_light.h>

#include <cstdio>
#include <cstring>
#include <string>

#include "app.h"
#include "net_time.h"
#include "updates.h"

namespace protocol
{

namespace
{
// The lightness of `status`, written with one decimal and handed to the serializer as it is. It lives until the reply
// has been serialized.
char lightness_text[16];
} // namespace

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

void write_wifi(JsonObject wifi, const network::Snapshot &net)
{
  wifi["state"] = zenit::net::wifi_state_name(net.state);
  if (net.ssid[0])
  {
    // A stored name is valid UTF-8 without controls (valid_wifi_name); quoting is a second line of defence, so no byte
    // that JSON cannot carry ever reaches a reply
    char safe[6 * zenit::net::MAX_SSID + 1];
    zenit::proto::quote_text(net.ssid, std::strlen(net.ssid), safe, sizeof(safe));
    wifi["ssid"] = std::string(safe);
  }
  else
    wifi["ssid"] = nullptr;
  if (net.state == zenit::net::WifiState::Connected && net.rssi_known)
    wifi["rssi"] = net.rssi;
  else
    wifi["rssi"] = nullptr;
  if (net.has_ip)
    wifi["ip"] = std::string(net.ip);
  else
    wifi["ip"] = nullptr;
  wifi["hostname"] = std::string(net.hostname);
}

void write_time(JsonObject time, const network::Snapshot &net)
{
  time["synced"] = net.time_synced;
  if (net.time_synced)
  {
    time["epoch"] = net.epoch;
    time["local_minute"] = net_time::local_minute(net.epoch);
  }
  else
  {
    time["epoch"] = nullptr;
    time["local_minute"] = nullptr;
  }
}

void write_update(JsonObject update)
{
  const updates::Status status = updates::status();
  update["mode"] = status.mode;
  update["state"] = zenit::update::state_name(status.state);
  if (status.available[0])
    update["available"] = std::string(status.available);
  else
    update["available"] = nullptr;
  if (status.has_last_check)
    update["last_check"] = status.last_check;
  else
    update["last_check"] = nullptr;
  update["last_result"] = zenit::update::result_name(status.last_result);
  if (status.progress >= 0)
    update["progress"] = status.progress;
  else
    update["progress"] = nullptr;
  update["trial"] = status.trial;
  if (status.skipped[0])
    update["skipped"] = std::string(status.skipped);
  else
    update["skipped"] = nullptr;
  if (status.rolled_back[0])
    update["rolled_back"] = std::string(status.rolled_back);
  else
    update["rolled_back"] = nullptr;
  if (status.has_target)
    update["target"] = status.target == install_target::Target::Web ? "web" : "firmware";
  else
    update["target"] = nullptr;
  JsonObject web = update["web"].to<JsonObject>();
  web["state"] = zenit::update::web_state_name(status.web.state);
  if (status.web.version[0])
    web["version"] = std::string(status.web.version);
  else
    web["version"] = nullptr;
  if (status.web.available[0])
    web["available"] = std::string(status.web.available);
  else
    web["available"] = nullptr;
  web["last_result"] = zenit::update::result_name(status.web.last_result);
  if (status.web.retry_in >= 0)
    web["retry_in"] = status.web.retry_in;
  else
    web["retry_in"] = nullptr;
}

} // namespace protocol
