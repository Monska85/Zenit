// SPDX-License-Identifier: GPL-3.0-or-later

// SHA-256 (FIPS 180-4) and HMAC-SHA256 (RFC 2104). The hash itself is a board and simulator pair: the board runs
// mbedTLS on the chip's SHA engine (src/sha256_board.cpp), the simulator and the tests the portable code of
// src/sha256_sim.cpp. HMAC and the rest are built on it here.

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
  Sha256();
  ~Sha256();
  Sha256(const Sha256 &) = delete;
  Sha256 &operator=(const Sha256 &) = delete;

  // Starts a new hash.
  void reset();
  void update(const void *data, size_t size);
  // Writes the digest of the bytes since the last start, then starts a new hash. False when the hash engine failed: the
  // digest is then meaningless and must not be compared.
  [[nodiscard]] bool finish(uint8_t (&digest)[SHA256_SIZE]);

  // The room each implementation keeps its state in; each checks at compile time that its state fits.
  static constexpr size_t STATE_SIZE = 128;

private:
  alignas(8) unsigned char state_[STATE_SIZE];
};

// The digest as lowercase hexadecimal and a NUL.
void to_hex(const uint8_t (&digest)[SHA256_SIZE], char (&out)[SHA256_HEX + 1]);

// HMAC-SHA256 of `message` under `key`, as lowercase hexadecimal and a NUL. False, with `out` empty, when the hash
// engine failed.
[[nodiscard]] bool hmac_sha256_hex(const void *key, size_t key_size, const void *message, size_t message_size,
                                   char (&out)[SHA256_HEX + 1]);

// Compares two byte strings of the same length without stopping at the first difference.
bool constant_time_equal(const char *a, const char *b, size_t size);

} // namespace net
} // namespace zenit
