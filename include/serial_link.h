// SPDX-License-Identifier: GPL-3.0-or-later

// The USB serial transport of the command protocol (docs/protocol/protocol-v1.md#usb-serial). Board only: the
// simulator reads standard input in src/sim_main.cpp.

#pragma once

#include <cstdint>

namespace serial_link
{

// Connects Improv's frames to the serial port. Call once, before the first poll.
void begin();

// Reads the bytes that have arrived, without waiting, and handles at most one complete line. Call it on every pass of
// loop().
void poll(uint64_t now);

} // namespace serial_link
