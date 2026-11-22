// SPDX-License-Identifier: GPL-3.0-or-later

// SHA-256 (FIPS 180-4) and HMAC-SHA256 (RFC 2104), one implementation for the board, the simulator and the tests.

#pragma once

#include <cstddef>
#include <cstdint>

namespace zenit
{
namespace net
{

constexpr size_t SHA256_SIZE = 32;
// Hexadecimal digits of a digest, without the terminating NUL.
constexpr size_t SHA256_HEX = 64;

class Sha256
{
public:
  Sha256() { reset(); }
  void reset();
  void update(const void *data, size_t size);
  void finish(uint8_t (&digest)[SHA256_SIZE]);

private:
  void block(const uint8_t *bytes);
  uint32_t state_[8];
  uint8_t buffer_[64];
  uint64_t total_ = 0;
  size_t used_ = 0;
};

// The digest as lowercase hexadecimal and a NUL.
void to_hex(const uint8_t (&digest)[SHA256_SIZE], char (&out)[SHA256_HEX + 1]);

// HMAC-SHA256 of `message` under `key`, as lowercase hexadecimal and a NUL.
void hmac_sha256_hex(const void *key, size_t key_size, const void *message, size_t message_size,
                     char (&out)[SHA256_HEX + 1]);

// Compares two byte strings of the same length without stopping at the first difference.
bool constant_time_equal(const char *a, const char *b, size_t size);

} // namespace net
} // namespace zenit
