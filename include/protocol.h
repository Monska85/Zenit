// SPDX-License-Identifier: GPL-3.0-or-later

// The command protocol of docs/protocol/protocol-v1.md. The core takes one line and writes the reply line, so every
// transport drives it the same way: the USB serial port on the board, standard input in the simulator, the WebSocket
// later. It runs on the loop task only.

#pragma once

#include <cstddef>
#include <cstdint>

namespace protocol
{

// Where a request came from. `settings_reset` works over USB only.
enum class Transport : uint8_t
{
  Usb,
  Wifi
};

// Writes one complete line, newline included, in a single piece, so it never mixes with a log line.
using Writer = void (*)(const char *line, size_t length);

// Starts the protocol after a boot: forgets the remembered replies and sets the boot id `info` reports.
void begin(uint32_t boot_id);

// Handles one received line, without its newline and without the one `\r` before it, which the transport removes (the
// line reader does; a WebSocket message has none). Any other `\r` is part of the JSON and breaks it. Writes at most one
// reply line. A line that is not a protocol line gets no reply.
void handle_line(Transport transport, const char *line, size_t length, uint64_t now, Writer write);

// Answers a protocol line that was longer than the line limit and has been dropped.
void line_too_long(Transport transport, Writer write);

// A WiFi connection opened or closed: the reply remembered for the WiFi transport is forgotten.
void wifi_opened();
void wifi_closed();

} // namespace protocol
