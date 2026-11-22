// SPDX-License-Identifier: GPL-3.0-or-later

#include "wifi_logic.h"

namespace zenit
{
namespace net
{

const char *wifi_state_name(WifiState state)
{
  switch (state)
  {
  case WifiState::NotConfigured:
    return "not_configured";
  case WifiState::Connecting:
    return "connecting";
  case WifiState::Connected:
    return "connected";
  case WifiState::NotFound:
    return "not_found";
  case WifiState::WrongPassword:
    return "wrong_password";
  case WifiState::NoAddress:
    return "no_address";
  }
  return "connecting";
}

WifiState state_for_disconnect(uint8_t reason)
{
  switch (reason)
  {
  case REASON_NO_AP_FOUND:
    return WifiState::NotFound;
  case REASON_AUTH_FAIL:
  case REASON_4WAY_HANDSHAKE_TIMEOUT:
  case REASON_HANDSHAKE_TIMEOUT:
  case REASON_MIC_FAILURE:
  case REASON_802_1X_AUTH_FAILED:
    return WifiState::WrongPassword;
  default:
    return WifiState::Connecting;
  }
}

uint32_t reconnect_wait_ms(uint32_t failures)
{
  const uint32_t step = failures == 0 ? 0 : failures - 1;
  return step >= 6 ? 60000 : 1000u << step;
}

bool power_fallback_due(WifiPower setting, uint32_t failures_in_a_row)
{
  return setting == WifiPower::Auto && failures_in_a_row >= POWER_FALLBACK_FAILURES;
}

int effective_power_quarter_dbm(WifiPower setting, uint32_t failures_in_a_row, bool fell_back)
{
  if (setting == WifiPower::Auto && (fell_back || power_fallback_due(setting, failures_in_a_row)))
    return LOW_POWER_QUARTER_DBM;
  return wifi_power_quarter_dbm(setting);
}

void hostname_from_mac(const uint8_t (&mac)[6], char (&out)[11])
{
  static const char HEX[] = "0123456789abcdef";
  const char prefix[] = "zenit-";
  for (size_t i = 0; i < 6; i++)
    out[i] = prefix[i];
  out[6] = HEX[mac[4] >> 4];
  out[7] = HEX[mac[4] & 15];
  out[8] = HEX[mac[5] >> 4];
  out[9] = HEX[mac[5] & 15];
  out[10] = '\0';
}

} // namespace net
} // namespace zenit
