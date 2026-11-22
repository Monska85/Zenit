// SPDX-License-Identifier: GPL-3.0-or-later

// SHA-256 (FIPS 180-4) in portable C++, for the simulator and the tests. The board hashes with mbedTLS
// (sha256_board.cpp); the conformance cases of conformance/net/hash.json hold both to the same digests.

#ifdef ZENIT_SIM

#include <sha256.h>

#include <cstring>
#include <new>

namespace zenit
{
namespace net
{

namespace
{
const uint32_t K[64] = {0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
                        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
                        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
                        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
                        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
                        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
                        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
                        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

struct State
{
  uint32_t h[8];
  uint8_t buffer[64];
  uint64_t total;
  size_t used;
};
static_assert(sizeof(State) <= Sha256::STATE_SIZE, "the SHA-256 state does not fit Sha256::STATE_SIZE");

State &state_of(unsigned char *storage) { return *std::launder(reinterpret_cast<State *>(storage)); }

uint32_t rotr(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }

void start(State &s)
{
  static const uint32_t INIT[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                                   0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  std::memcpy(s.h, INIT, sizeof(s.h));
  s.total = 0;
  s.used = 0;
}

void block(State &s, const uint8_t *p)
{
  uint32_t w[64];
  for (int i = 0; i < 16; i++)
    w[i] = (uint32_t)p[4 * i] << 24 | (uint32_t)p[4 * i + 1] << 16 | (uint32_t)p[4 * i + 2] << 8 | p[4 * i + 3];
  for (int i = 16; i < 64; i++)
  {
    const uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
    const uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint32_t a = s.h[0], b = s.h[1], c = s.h[2], d = s.h[3], e = s.h[4], f = s.h[5], g = s.h[6], h = s.h[7];
  for (int i = 0; i < 64; i++)
  {
    const uint32_t s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const uint32_t ch = (e & f) ^ (~e & g);
    const uint32_t t1 = h + s1 + ch + K[i] + w[i];
    const uint32_t s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
    const uint32_t t2 = s0 + maj;
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }
  s.h[0] += a;
  s.h[1] += b;
  s.h[2] += c;
  s.h[3] += d;
  s.h[4] += e;
  s.h[5] += f;
  s.h[6] += g;
  s.h[7] += h;
}
} // namespace

Sha256::Sha256()
{
  new (state_) State();
  start(state_of(state_));
}

Sha256::~Sha256() { state_of(state_).~State(); }

void Sha256::reset() { start(state_of(state_)); }

void Sha256::update(const void *data, size_t size)
{
  State &s = state_of(state_);
  const uint8_t *in = static_cast<const uint8_t *>(data);
  s.total += size;
  while (size > 0)
  {
    const size_t take = size < 64 - s.used ? size : 64 - s.used;
    std::memcpy(s.buffer + s.used, in, take);
    s.used += take;
    in += take;
    size -= take;
    if (s.used == 64)
    {
      block(s, s.buffer);
      s.used = 0;
    }
  }
}

bool Sha256::finish(uint8_t (&digest)[SHA256_SIZE])
{
  State &s = state_of(state_);
  const uint64_t bits = s.total * 8;
  const uint8_t one = 0x80;
  update(&one, 1);
  const uint8_t zero = 0;
  while (s.used != 56)
    update(&zero, 1);
  uint8_t length[8];
  for (int i = 0; i < 8; i++)
    length[i] = (uint8_t)(bits >> (56 - 8 * i));
  update(length, 8);
  for (int i = 0; i < 8; i++)
  {
    digest[4 * i] = (uint8_t)(s.h[i] >> 24);
    digest[4 * i + 1] = (uint8_t)(s.h[i] >> 16);
    digest[4 * i + 2] = (uint8_t)(s.h[i] >> 8);
    digest[4 * i + 3] = (uint8_t)s.h[i];
  }
  start(s);
  return true;
}

} // namespace net
} // namespace zenit

#endif
