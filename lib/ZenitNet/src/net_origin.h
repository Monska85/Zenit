// SPDX-License-Identifier: GPL-3.0-or-later

// The origin check of the WebSocket (docs/protocol/protocol-v1.md#websocket).

#pragma once

#include <cstddef>

namespace zenit
{
namespace net
{

// The origin (`https://host`, lowercase, no default port) of a site address, written into `out`. False, and `out`
// empty, when the address is not an https URL with a host.
bool site_origin_of(const char *site_url, char *out, size_t size);

// Whether a connection with this `Origin` header (null when the header is missing) is accepted: no origin, the site's
// origin, localhost, a `.local` name or a private IPv4 address, over http or https.
bool origin_allowed(const char *origin, const char *site_origin);

} // namespace net
} // namespace zenit
