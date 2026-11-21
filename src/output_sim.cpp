// SPDX-License-Identifier: GPL-3.0-or-later

#ifdef ZENIT_SIM

#include "output.h"

namespace output
{

namespace
{
zenit::Duties last;
bool led = false;
} // namespace

void begin()
{
  last = zenit::Duties();
  led = false;
}

void write(const zenit::Duties &duties) { last = duties; }

void status_led(bool on) { led = on; }

const zenit::Duties &sim_duties() { return last; }
bool sim_status_led() { return led; }

} // namespace output

#endif
