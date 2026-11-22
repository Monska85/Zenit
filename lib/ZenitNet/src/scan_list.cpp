// SPDX-License-Identifier: GPL-3.0-or-later

#include "scan_list.h"

#include <cstring>

namespace zenit
{
namespace net
{

bool scan_ssid_length(const uint8_t (&field)[MAX_SSID + 1], size_t &length)
{
  size_t end = 0;
  while (end < sizeof(field) && field[end] != 0)
    end++;
  if (end == sizeof(field))
    return false; // no terminating zero: a name of 33 bytes or more
  for (size_t i = end; i < sizeof(field); i++)
    if (field[i] != 0)
      return false;
  length = end;
  return true;
}

void scan_add(ScanEntry *list, size_t &count, size_t capacity, const char *name, size_t name_size, int rssi,
              bool secure)
{
  // A name that cannot be sent back or reported is not a network of the list, so it never ranks
  if (!valid_wifi_name_bytes(name, name_size))
    return;
  ScanEntry found = {};
  std::memcpy(found.ssid, name, name_size);
  found.rssi = rssi;
  found.secure = secure;
  for (size_t i = 0; i < count; i++)
    if (std::strcmp(list[i].ssid, found.ssid) == 0)
    {
      if (found.rssi > list[i].rssi)
        list[i] = found;
      return;
    }
  if (count < capacity)
  {
    list[count++] = found;
    return;
  }
  size_t weakest = 0;
  for (size_t i = 1; i < count; i++)
    if (list[i].rssi < list[weakest].rssi)
      weakest = i;
  if (found.rssi > list[weakest].rssi)
    list[weakest] = found;
}

void scan_sort(ScanEntry *list, size_t count)
{
  // A stable insertion sort: the list is at most 16 entries
  for (size_t i = 1; i < count; i++)
  {
    const ScanEntry entry = list[i];
    size_t j = i;
    while (j > 0 && list[j - 1].rssi < entry.rssi)
    {
      list[j] = list[j - 1];
      j--;
    }
    list[j] = entry;
  }
}

} // namespace net
} // namespace zenit
