// SPDX-License-Identifier: GPL-3.0-or-later

#include "app.h"

#include "firmware.h"
#include "improv.h"
#include "net_time.h"
#include "network.h"
#include "output.h"
#include "platform.h"
#include "protocol.h"
#include "updates.h"
#include "www.h"

namespace app
{

namespace
{
zenit::LightEngine engine;
zenit::LightFrame frame;
bool written = false;

// "Turn on with this" at a power-up (docs/board/light-v1.md#favorites): the start favorite becomes the light settings
// before the first output. It is saved when it differs, except on a trial boot, when the previous firmware may boot
// again and no save may happen before this one confirms: then it is applied in RAM and the next save that changes
// something writes it.
void apply_start_favorite_at_power_up()
{
  const zenit::Favorites &favorites = settings::favorites();
  const zenit::Favorite *start = zenit::find_favorite(favorites, favorites.start);
  if (!start)
    return;
  const zenit::LightSettings look = zenit::apply_favorite_look(settings::current(), *start);
  if (firmware::on_trial())
    settings::use_unsaved(look);
  else if (settings::commit(look) != settings::Commit::Ok)
    platform::log("the start favorite could not be saved: the light starts with the stored settings");
}
} // namespace

void begin(uint64_t now, uint32_t seed)
{
  written = false;
  apply_start_favorite_at_power_up();
  engine = zenit::LightEngine();
  engine.start(settings::current(), now, seed);
  net_time::set_zone(settings::board().timezone);
  network::begin(settings::board());
  improv_link::begin();
  www::begin();
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

settings::Commit turn_on(uint64_t now)
{
  const zenit::Favorites &favorites = settings::favorites();
  const zenit::Favorite *start = zenit::find_favorite(favorites, favorites.start);
  // Only a turn-on from off applies the start favorite: during the timer's fade-out the light is on and comes back up
  if (start && !tick(now).status.on)
    if (change_settings(zenit::apply_favorite_look(settings::current(), *start), settings::board(), now) !=
        settings::Commit::Ok)
      return settings::Commit::Failed;
  engine.set_on(true, now);
  return settings::Commit::Ok;
}

settings::Commit apply_favorite(const zenit::Favorite &favorite, uint64_t now)
{
  if (change_settings(zenit::apply_favorite_look(settings::current(), favorite), settings::board(), now) !=
      settings::Commit::Ok)
    return settings::Commit::Failed;
  engine.set_on(true, now);
  return settings::Commit::Ok;
}

const zenit::LightFrame &last_frame() { return frame; }

} // namespace app
