// SPDX-License-Identifier: GPL-3.0-or-later

// The HTTP and WebSocket server of the board (docs/board/wifi-and-updates-v1.md#the-served-web-app). Board only; the
// simulator's bridge (tools/ws_bridge.py) plays it.

#pragma once

#include <ws_message.h>

#include <cstdint>

#include <cstdint>

namespace ws_server
{

// Prepares the answers and queues. Call once, from the loop task, before the network task starts.
void begin();
// The network task starts and stops the server with the WiFi connection.
// False when the server could not start (it is then tried again by the caller).
bool start();
bool running();
void stop();
// The loop task: runs the protocol lines that clients sent and hands the replies back.
void poll(uint64_t now);
// The loop task asks to close the client's connection: CLOSE_POLICY (a failed login, a new token) or CLOSE_RELOAD (a
// new web app). Any other code is sent as CLOSE_POLICY.
void close_client(uint16_t code = zenit::proto::CLOSE_POLICY);

} // namespace ws_server
