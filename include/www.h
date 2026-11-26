// SPDX-License-Identifier: GPL-3.0-or-later

// The web app in the `www` partition (docs/board/wifi-and-updates-v1.md#web-image): its state, the files the HTTP
// server serves, and the install the network task writes. Board: esp_partition (src/www_board.cpp); simulator: an image
// in memory (src/www_sim.cpp).

#pragma once

#include <net_http.h>
#include <web_image.h>
#include <update_status.h>

#include <cstddef>
#include <cstdint>

namespace www
{

// Reads the partition and sets the state. Call once at the start.
void begin();
zenit::update::WebState state();

// The state and the version of the image (empty unless the state is ok or incompatible, so none while installing),
// copied together under a lock:
// an install on the network task rewrites them.
struct Info
{
  zenit::update::WebState state;
  char version[zenit::net::WEB_VERSION_FIELD + 1];
};
Info info();

// The server task, around each file it sends: `serve_begin` gives the files while the state is ok (false otherwise, and
// then `serve_end` is not called). An install waits for the files being sent before it touches the partition.
bool serve_begin(const zenit::net::Asset *&assets, size_t &count);
void serve_end();

// The network task's install of an image of `size` bytes whose header must carry `version` and speak the firmware's
// protocol: the state is `installing` from `begin_install` on. Each returns false on failure. An image refused by its
// header leaves the old one in place; a failure later, or `abort_install` after the first erase, leaves no image
// (state `missing`). `end_install` writes the header and reads the image again, which sets the state.
bool begin_install(uint32_t size, const char *version);
bool write(const uint8_t *data, size_t size);
// Whether the last write failed because the image's header was refused, not the flash.
bool install_refused();
// Whether the last `begin_install` failed because a file was still being sent after the wait, not the flash: nothing
// was touched, and the install can be tried again later.
bool install_busy();
bool end_install();
void abort_install();

#ifdef ZENIT_SIM
// Simulator: the model's controls.
void sim_reset();                                // a valid image of version 1.0.0 that speaks protocol 1
void sim_load(const uint8_t *data, size_t size); // the partition holds these bytes (then reads it as at a start)
void sim_erase();                                // no image
void sim_fail(const char *step);                 // "begin", "write", "end" or "busy" (a page send); "" clears
// A valid image of `version` with one file, index.html, for tests and the scripted update source.
void sim_make_image(const char *version, uint8_t protocol_min, uint8_t protocol_max, uint8_t *&data, size_t &size);
#endif

} // namespace www
