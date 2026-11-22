// SPDX-License-Identifier: GPL-3.0-or-later

// setup() and loop() of the board. The simulator has its own entry point, src/sim_main.cpp.

#ifndef ZENIT_SIM

#include <Arduino.h>

#include "app.h"
#include "output.h"
#include "platform.h"
#include "protocol.h"
#include "serial_link.h"
#include "settings.h"

namespace
{
constexpr unsigned long SERIAL_BAUD = 115200;
constexpr size_t SERIAL_RX_BUFFER = 4096;
uint64_t next_tick = 0;
} // namespace

void setup()
{
  // Outputs first: every channel low, before anything else can take time.
  output::begin();
  Serial.setRxBufferSize(SERIAL_RX_BUFFER);
  Serial.begin(SERIAL_BAUD);
  settings::begin();
  protocol::begin(platform::random32());
  const uint64_t now = platform::now_ms();
  app::begin(now, platform::random32());
  app::tick(now);
  next_tick = now + zenit::TICK_MS;
  platform::log("firmware %s on %s", platform::firmware_version(), platform::board_name());
}

void loop()
{
  const uint64_t now = platform::now_ms();
  serial_link::poll(now);
  if (now >= next_tick)
  {
    app::tick(now);
    // The next tick on the 10 ms grid; a late tick does not try to catch up.
    next_tick = now - now % zenit::TICK_MS + zenit::TICK_MS;
  }
  delay(1);
}

#endif
