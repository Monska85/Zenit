// SPDX-License-Identifier: GPL-3.0-or-later

// The network login of one WiFi connection (docs/protocol/protocol-v1.md#authentication).

#pragma once

#include <cstddef>
#include <cstdint>

#include "sha256.h"

namespace zenit
{
namespace net
{

constexpr size_t NONCE_BYTES = 16;
constexpr size_t NONCE_HEX = 32;
constexpr int MAX_AUTH_FAILURES = 3;

// Whether `text` is 64 lowercase hexadecimal digits.
bool is_hmac_text(const char *text);

class AuthSession
{
public:
  enum class Verdict
  {
    Accepted,
    Refused,
    RefusedAndClose
  };

  void reset();
  bool authenticated() const { return authenticated_; }
  // Makes a nonce from `random` and returns it as 32 lowercase hexadecimal digits and a NUL, valid until the next
  // challenge or attempt.
  const char *challenge(const uint8_t (&random)[NONCE_BYTES]);
  // Checks `hmac` against the pending nonce under `token`. A nonce serves one attempt.
  Verdict attempt(const char *token, const char *hmac);

private:
  char nonce_[NONCE_HEX + 1] = {0};
  bool has_nonce_ = false;
  bool authenticated_ = false;
  int failures_ = 0;
};

} // namespace net
} // namespace zenit
