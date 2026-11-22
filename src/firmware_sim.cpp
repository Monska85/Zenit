// SPDX-License-Identifier: GPL-3.0-or-later

// The firmware slots as the simulator models them: a trial flag, an invalid-slot flag, a byte counter, and failures
// the tests inject at each step.

#ifdef ZENIT_SIM

#include "firmware.h"

#include <cstring>
#include <string>

namespace firmware
{

namespace
{
bool trial = false;
bool other_invalid = false;
std::string failing;
bool installing = false;
uint32_t expected = 0;
uint32_t written = 0;
bool activated = false;
bool restarted = false;
bool invalid_marked = false;
bool valid_marked = false;

bool fails(const char *step) { return failing == step; }
} // namespace

bool on_trial() { return trial; }
bool other_slot_invalid() { return other_invalid; }

bool mark_valid()
{
  if (fails("mark_valid"))
    return false;
  trial = false;
  valid_marked = true;
  return true;
}

void mark_invalid_and_restart()
{
  invalid_marked = true;
  restarted = true;
}

bool begin_install(uint32_t size)
{
  if (fails("begin") || installing)
    return false;
  installing = true;
  expected = size;
  written = 0;
  return true;
}

bool write(const uint8_t *, size_t size)
{
  if (!installing || fails("write") || written + size > expected)
    return false;
  written += static_cast<uint32_t>(size);
  return true;
}

bool end_install()
{
  const bool ok = installing && !fails("end") && written == expected;
  if (!ok)
    installing = false;
  return ok;
}

void abort_install() { installing = false; }

bool activate()
{
  installing = false;
  if (fails("activate"))
    return false;
  activated = true;
  return true;
}

void restart() { restarted = true; }

void sim_reset()
{
  trial = other_invalid = installing = activated = restarted = invalid_marked = valid_marked = false;
  failing.clear();
  expected = written = 0;
}
void sim_set_trial(bool value) { trial = value; }
void sim_set_other_invalid(bool value) { other_invalid = value; }
void sim_fail(const char *step) { failing = step; }
bool sim_activated() { return activated; }
bool sim_restarted() { return restarted; }
bool sim_marked_invalid() { return invalid_marked; }
bool sim_marked_valid() { return valid_marked; }
uint32_t sim_written() { return written; }

} // namespace firmware

#endif
