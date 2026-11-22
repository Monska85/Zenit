// SPDX-License-Identifier: GPL-3.0-or-later

// The parts of a `status` reply and of the update replies as JSON (docs/protocol/protocol-v1.md#status): what the
// light, the network, the time and the update flow report. The command code in protocol.cpp only calls them.

#pragma once

#include <ArduinoJson.h>

#include "network.h"

namespace protocol
{

// The light as the last tick left it.
void write_light(JsonObject light);
void write_wifi(JsonObject wifi, const network::Snapshot &net);
void write_time(JsonObject time, const network::Snapshot &net);
// The update status, as `status.update` and the update replies have it.
void write_update(JsonObject update);

} // namespace protocol
