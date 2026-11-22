// SPDX-License-Identifier: GPL-3.0-or-later

// The networks a WiFi scan found, kept as one entry per network name with its strongest access point, and the best
// MAX_SCAN of them (docs/board/wifi-and-updates-v1.md#setup-with-improv).

#pragma once

#include <cstddef>
#include <cstdint>

#include "board_settings.h"

namespace zenit
{
namespace net
{

constexpr size_t MAX_SCAN_RESULTS = 16;

struct ScanEntry
{
  char ssid[MAX_SSID + 1];
  int rssi;
  bool secure;
};

// The name in the 33-byte SSID field of a scan record (32 bytes of name and a terminating zero): its length, which is
// where the first zero is. False, and the record is refused, when any byte after that first zero is not zero, because
// the name then holds a NUL and cannot be sent back or reported (`Home\0Evil` is not `Home`).
bool scan_ssid_length(const uint8_t (&field)[MAX_SSID + 1], size_t &length);

// Adds one access point found by the scan to `list` (`count` entries, room for `capacity`). The name is given as the
// bytes the scan reported and their number, and is judged as it is (valid_wifi_name_bytes: a name that is too long or
// not valid is left out, never cut to fit first). A name already listed keeps its stronger access point; a new name is
// added, and when the list is full it replaces the weakest entry if it is stronger than that one. A scan of many access
// points so keeps the strongest names, whatever the order.
void scan_add(ScanEntry *list, size_t &count, size_t capacity, const char *name, size_t name_size, int rssi,
              bool secure);

// Sorts the list strongest first; equal signals keep the order they were found in.
void scan_sort(ScanEntry *list, size_t count);

} // namespace net
} // namespace zenit
