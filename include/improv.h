// SPDX-License-Identifier: GPL-3.0-or-later

// Improv Wi-Fi Serial on the loop task (docs/board/wifi-and-updates-v1.md#setup-with-improv): the RPC commands over the
// network API. The frames come from the serial link's splitter (lib/ZenitImprov).

#pragma once

#include <cstdint>
#include <functional>
#include <string>

namespace improv_link
{

// Where the board's frames go: the serial port, or a test's capture.
using Sink = std::function<void(const std::string &frame)>;
void set_sink(Sink sink);

void begin();
void handle_frame(uint8_t type, const std::string &data, uint64_t now);
void handle_bad_checksum();
// Moves on a connection or a scan that is waiting.
void poll(uint64_t now);
// Whether a connection started by Improv is being made (the board LED blinks).
bool connecting();

} // namespace improv_link
