// SPDX-License-Identifier: GPL-3.0-or-later

#include "sha256.h"

#include <cstring>

namespace zenit
{
namespace net
{

namespace
{
bool fail_hex(char (&out)[SHA256_HEX + 1])
{
  out[0] = '\0';
  return false;
}
} // namespace

void to_hex(const uint8_t (&digest)[SHA256_SIZE], char (&out)[SHA256_HEX + 1])
{
  static const char HEX[] = "0123456789abcdef";
  for (size_t i = 0; i < SHA256_SIZE; i++)
  {
    out[2 * i] = HEX[digest[i] >> 4];
    out[2 * i + 1] = HEX[digest[i] & 15];
  }
  out[SHA256_HEX] = '\0';
}

bool hmac_sha256_hex(const void *key, size_t key_size, const void *message, size_t message_size,
                     char (&out)[SHA256_HEX + 1])
{
  uint8_t block_key[64] = {0};
  if (key_size > 64)
  {
    Sha256 hash;
    hash.update(key, key_size);
    uint8_t digest[SHA256_SIZE];
    if (!hash.finish(digest))
      return fail_hex(out);
    std::memcpy(block_key, digest, SHA256_SIZE);
  }
  else if (key_size > 0)
    std::memcpy(block_key, key, key_size);
  uint8_t pad[64];
  for (size_t i = 0; i < 64; i++)
    pad[i] = block_key[i] ^ 0x36;
  Sha256 inner;
  inner.update(pad, 64);
  inner.update(message, message_size);
  uint8_t inner_digest[SHA256_SIZE];
  if (!inner.finish(inner_digest))
    return fail_hex(out);
  for (size_t i = 0; i < 64; i++)
    pad[i] = block_key[i] ^ 0x5c;
  Sha256 outer;
  outer.update(pad, 64);
  outer.update(inner_digest, SHA256_SIZE);
  uint8_t digest[SHA256_SIZE];
  if (!outer.finish(digest))
    return fail_hex(out);
  to_hex(digest, out);
  return true;
}

bool constant_time_equal(const char *a, const char *b, size_t size)
{
  uint8_t difference = 0;
  for (size_t i = 0; i < size; i++)
    difference |= (uint8_t)(a[i] ^ b[i]);
  return difference == 0;
}

} // namespace net
} // namespace zenit
