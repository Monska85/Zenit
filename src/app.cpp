// SPDX-License-Identifier: GPL-3.0-or-later

#include "app.h"

#include "output.h"

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

void set_light(bool on, uint64_t now) { engine.set_on(on, now); }

const zenit::LightFrame &last_frame() { return frame; }

} // namespace app
