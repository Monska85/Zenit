// SPDX-License-Identifier: GPL-3.0-or-later

// The WiFi decisions of docs/board/wifi-and-updates-v1.md#wifi, with no radio in them: the state, the wait between
// tries, the power fallback and the hostname.

#pragma once

#include <cstddef>
#include <cstdint>

#include "board_settings.h"

namespace zenit
{
namespace net
{

enum class WifiState : uint8_t
{
  NotConfigured,
  Connecting,
  Connected,
  NotFound,
  WrongPassword,
  NoAddress
};

const char *wifi_state_name(WifiState state);

// ESP-IDF's disconnect reasons that tell why a try failed (esp_wifi_types_generic.h).
constexpr uint8_t REASON_4WAY_HANDSHAKE_TIMEOUT = 15;
constexpr uint8_t REASON_NO_AP_FOUND = 201;
constexpr uint8_t REASON_AUTH_FAIL = 202;
constexpr uint8_t REASON_HANDSHAKE_TIMEOUT = 204;
// No access point of that name with a security the station accepts (a WPA or WEP network when a password asks for
// WPA2 at least), none within the auth mode threshold, none within the signal threshold.
constexpr uint8_t REASON_NO_AP_FOUND_W_COMPATIBLE_SECURITY = 210;
constexpr uint8_t REASON_NO_AP_FOUND_IN_AUTHMODE_THRESHOLD = 211;
constexpr uint8_t REASON_NO_AP_FOUND_IN_RSSI_THRESHOLD = 212;
constexpr uint8_t REASON_MIC_FAILURE = 14;
constexpr uint8_t REASON_802_1X_AUTH_FAILED = 23;
constexpr uint8_t REASON_AUTH_EXPIRE = 2;
constexpr uint8_t REASON_CONNECTION_FAIL = 205;

// The state a failed try leaves, from the disconnect reason.
WifiState state_for_disconnect(uint8_t reason);

// An Improv try (docs/board/wifi-and-updates-v1.md#setup-with-improv) has this long from the moment the loop task
// queued it. The network task measures it, even when it takes the request late after a scan, a check or a download, and
// decides the outcome: a try out of time fails without touching the radio, and a connection made after the deadline is
// not a success. The loop task waits 2 s longer, so the network task's answer always arrives first.
constexpr uint32_t PROVISION_MS = 30000;
constexpr uint32_t PROVISION_REPLY_MS = PROVISION_MS + 2000;

// Whether the try queued at `queued_at` is out of time at `now` (both on the same millisecond clock, which may wrap).
inline bool provision_expired(uint32_t queued_at, uint32_t now) { return now - queued_at >= PROVISION_MS; }

// The address wait: a connection without an address after this long is `no_address`.
constexpr uint32_t ADDRESS_WAIT_MS = 15000;

// The wait before the next try, in milliseconds: 1, 2, 4, 8, 16, 32 s, then 60 s. `failures` counts the tries that
// failed since the last connection.
uint32_t reconnect_wait_ms(uint32_t failures);

// When a service that failed to start may be tried again: after the waits of a reconnection (1, 2, 4 ... 32 s, then
// one minute), counted from each failure.
class RetryTimer
{
public:
  bool due(uint32_t now_ms) const { return failures_ == 0 || static_cast<int32_t>(now_ms - next_ms_) >= 0; }
  void failed(uint32_t now_ms)
  {
    failures_++;
    next_ms_ = now_ms + reconnect_wait_ms(failures_);
  }
  void reset() { failures_ = 0; }
  uint32_t failures() const { return failures_; }

private:
  uint32_t failures_ = 0;
  uint32_t next_ms_ = 0;
};

// The transmit power to use, in quarters of dBm, under the `auto` fallback of the spec.
constexpr int LOW_POWER_QUARTER_DBM = 34;
constexpr uint32_t POWER_FALLBACK_FAILURES = 3;
int effective_power_quarter_dbm(WifiPower setting, uint32_t failures_in_a_row, bool fell_back);
// Whether `auto` has failed enough to stay at low power until the restart.
bool power_fallback_due(WifiPower setting, uint32_t failures_in_a_row);

// `zenit-` and the last two bytes of the MAC as four lowercase hexadecimal digits.
void hostname_from_mac(const uint8_t (&mac)[6], char (&out)[11]);

} // namespace net
} // namespace zenit
