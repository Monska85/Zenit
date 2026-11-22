// SPDX-License-Identifier: GPL-3.0-or-later

// SHA-256 on the board: mbedTLS, already linked for HTTPS, which runs on the ESP32-C3's SHA engine. The simulator and
// the tests run the portable code of sha256_sim.cpp; the conformance cases of conformance/net/hash.json fix the
// digests.

#ifndef ZENIT_SIM

#include <sha256.h>

#include <mbedtls/sha256.h>

#include <cstring>
#include <new>

namespace zenit
{
namespace net
{

namespace
{
struct State
{
  mbedtls_sha256_context context;
  // An mbedTLS call failed since the last start: finish reports it.
  bool failed;
};
static_assert(sizeof(State) <= Sha256::STATE_SIZE, "the mbedTLS SHA-256 context does not fit Sha256::STATE_SIZE");
static_assert(alignof(State) <= 8, "the mbedTLS SHA-256 context needs a stricter alignment than Sha256 gives");

State &state_of(unsigned char *storage) { return *std::launder(reinterpret_cast<State *>(storage)); }

void start(State &s)
{
  mbedtls_sha256_init(&s.context);
  s.failed = mbedtls_sha256_starts(&s.context, 0) != 0;
}
} // namespace

Sha256::Sha256()
{
  new (state_) State();
  start(state_of(state_));
}

Sha256::~Sha256()
{
  State &s = state_of(state_);
  mbedtls_sha256_free(&s.context);
  s.~State();
}

void Sha256::reset()
{
  State &s = state_of(state_);
  mbedtls_sha256_free(&s.context);
  start(s);
}

void Sha256::update(const void *data, size_t size)
{
  State &s = state_of(state_);
  if (!s.failed && size > 0)
    s.failed = mbedtls_sha256_update(&s.context, static_cast<const unsigned char *>(data), size) != 0;
}

bool Sha256::finish(uint8_t (&digest)[SHA256_SIZE])
{
  State &s = state_of(state_);
  const bool ok = !s.failed && mbedtls_sha256_finish(&s.context, digest) == 0;
  if (!ok)
    std::memset(digest, 0, SHA256_SIZE);
  reset();
  return ok;
}

} // namespace net
} // namespace zenit

#endif
