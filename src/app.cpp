// SPDX-License-Identifier: GPL-3.0-or-later

#include "app.h"

#include "improv.h"
#include "net_time.h"
#include "network.h"
#include "output.h"
#include "protocol.h"
#include "updates.h"

namespace app
{

namespace
{
zenit::LightEngine engine;
zenit::LightFrame frame;
bool written = false;
} // namespace

void begin(uint64_t now, uint32_t seed)
{
  written = false;
  engine = zenit::LightEngine();
  engine.start(settings::current(), now, seed);
  net_time::set_zone(settings::board().timezone);
  network::begin(settings::board());
  improv_link::begin();
  updates::begin(now);
}

const zenit::LightFrame &tick(uint64_t now)
{
  frame = engine.tick(now);
  output::write(frame.duties);
  written = true;
  return frame;
}

bool first_output_written() { return written; }

settings::Commit change_settings(const zenit::LightSettings &next, uint64_t now)
{
  settings::Commit result = settings::commit(next);
  if (result == settings::Commit::Ok)
    engine.apply(next, now);
  return result;
}

settings::Commit change_settings(const zenit::LightSettings &light, const zenit::net::BoardSettings &board,
                                 uint64_t now)
{
  const zenit::net::BoardSettings before = settings::board();
  const settings::Commit result = settings::commit_both(light, board);
  if (result != settings::Commit::Ok)
    return result;
  engine.apply(light, now);
  if (!(settings::board() == before))
  {
    net_time::set_zone(settings::board().timezone);
    network::apply(settings::board());
  }
  return result;
}

void service(uint64_t now)
{
  network::poll(now);
  protocol::poll(now);
  improv_link::poll(now);
  updates::tick(now);
  // The board LED blinks at 2 Hz while a connection started by Improv is being made, and is off otherwise.
  static bool led = false;
  const bool wanted = improv_link::connecting() && (now / 250) % 2 == 0;
  if (wanted != led)
  {
    led = wanted;
    output::status_led(led);
  }
}

void set_light(bool on, uint64_t now) { engine.set_on(on, now); }

const zenit::LightFrame &last_frame() { return frame; }

} // namespace app
