// SPDX-License-Identifier: GPL-3.0-or-later

#include "net_auth.h"

#include <cstring>

namespace zenit
{
namespace net
{

bool is_hmac_text(const char *text)
{
  if (std::strlen(text) != SHA256_HEX)
    return false;
  for (size_t i = 0; i < SHA256_HEX; i++)
    if (!((text[i] >= '0' && text[i] <= '9') || (text[i] >= 'a' && text[i] <= 'f')))
      return false;
  return true;
}

void AuthSession::reset()
{
  nonce_[0] = '\0';
  has_nonce_ = false;
  authenticated_ = false;
  failures_ = 0;
}

const char *AuthSession::challenge(const uint8_t (&random)[NONCE_BYTES])
{
  static const char HEX[] = "0123456789abcdef";
  for (size_t i = 0; i < NONCE_BYTES; i++)
  {
    nonce_[2 * i] = HEX[random[i] >> 4];
    nonce_[2 * i + 1] = HEX[random[i] & 15];
  }
  nonce_[NONCE_HEX] = '\0';
  has_nonce_ = true;
  return nonce_;
}

AuthSession::Verdict AuthSession::attempt(const char *token, const char *hmac)
{
  bool accepted = false;
  if (has_nonce_ && is_hmac_text(hmac) && std::strlen(token) > 0)
  {
    char expected[SHA256_HEX + 1];
    accepted = hmac_sha256_hex(token, std::strlen(token), nonce_, NONCE_HEX, expected) &&
               constant_time_equal(expected, hmac, SHA256_HEX);
  }
  has_nonce_ = false;
  nonce_[0] = '\0';
  if (accepted)
  {
    authenticated_ = true;
    return Verdict::Accepted;
  }
  return ++failures_ >= MAX_AUTH_FAILURES ? Verdict::RefusedAndClose : Verdict::Refused;
}

} // namespace net
} // namespace zenit
