// SPDX-License-Identifier: GPL-3.0-or-later

// The simulator's control lines for the network, the update source and the firmware slots
// (docs/board/wifi-and-updates-v1.md#tests-and-simulator). Simulator only.

#pragma once

#ifdef ZENIT_SIM

#include <cstdint>
#include <string>

namespace sim_control
{

// Handles a control line (starting with `!`) that belongs here. Returns false when the line is not one of these.
// `now` is the virtual time.
bool handle(const std::string &line, uint64_t now);

// Whether the firmware asked to restart and the simulator has restarted itself since the last call; a line
// `!restarted` has been written to standard output when it did. Call after every step of virtual time.
void after_step(uint64_t now);

// Tests keep the announcements (`!restarted`, `!sha256 ...`, `!close-client`) off standard output.
void set_quiet(bool quiet);

} // namespace sim_control

#endif
