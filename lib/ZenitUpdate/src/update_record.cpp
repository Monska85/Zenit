// SPDX-License-Identifier: GPL-3.0-or-later

#include "update_record.h"

#include <cstring>

namespace zenit
{
namespace update
{

bool operator==(const UpdateRecord &a, const UpdateRecord &b)
{
  return std::strcmp(a.pending, b.pending) == 0 && std::strcmp(a.skipped, b.skipped) == 0 &&
         std::strcmp(a.rolled_back, b.rolled_back) == 0 && a.booted == b.booted;
}

void encode_update_record(const UpdateRecord &r, uint8_t (&out)[UPDATE_RECORD_SIZE])
{
  std::memset(out, 0, UPDATE_RECORD_SIZE);
  out[0] = UPDATE_RECORD_VERSION;
  std::memcpy(out + 1, r.pending, RECORD_VERSION_TEXT);
  std::memcpy(out + 1 + RECORD_VERSION_TEXT, r.skipped, RECORD_VERSION_TEXT);
  std::memcpy(out + 1 + 2 * RECORD_VERSION_TEXT, r.rolled_back, RECORD_VERSION_TEXT);
  out[1 + 3 * RECORD_VERSION_TEXT] = r.booted ? 1 : 0;
}

namespace
{
bool read_field(const uint8_t *in, char (&field)[RECORD_VERSION_TEXT])
{
  std::memcpy(field, in, RECORD_VERSION_TEXT);
  for (size_t i = 0; i < RECORD_VERSION_TEXT; i++)
    if (field[i] == '\0')
      return true;
  return false;
}
} // namespace

bool decode_update_record(const uint8_t *in, size_t size, UpdateRecord &out)
{
  UpdateRecord r;
  if (!in || size != UPDATE_RECORD_SIZE || in[0] != UPDATE_RECORD_VERSION || !read_field(in + 1, r.pending) ||
      !read_field(in + 1 + RECORD_VERSION_TEXT, r.skipped) ||
      !read_field(in + 1 + 2 * RECORD_VERSION_TEXT, r.rolled_back) || in[1 + 3 * RECORD_VERSION_TEXT] > 1)
  {
    out = UpdateRecord();
    return false;
  }
  r.booted = in[1 + 3 * RECORD_VERSION_TEXT] == 1;
  out = r;
  return true;
}

bool set_version(char (&field)[RECORD_VERSION_TEXT], const char *version)
{
  if (std::strlen(version) >= RECORD_VERSION_TEXT)
    return false;
  std::memset(field, 0, RECORD_VERSION_TEXT);
  std::strcpy(field, version);
  return true;
}

BootAction decide_settled_boot(const UpdateRecord &record, const char *running_version, bool other_slot_invalid)
{
  if (record.pending[0] == '\0')
    return BootAction::Nothing;
  if (std::strcmp(record.pending, running_version) == 0)
    return BootAction::DropPending;
  return other_slot_invalid && record.booted ? BootAction::Rollback : BootAction::DropPending;
}

UpdateRecord apply_boot_action(const UpdateRecord &record, BootAction action)
{
  UpdateRecord next = record;
  switch (action)
  {
  case BootAction::Nothing:
    break;
  case BootAction::DropPending:
    std::memset(next.pending, 0, sizeof(next.pending));
    next.booted = false;
    break;
  case BootAction::Rollback:
    std::memcpy(next.skipped, record.pending, sizeof(next.skipped));
    std::memcpy(next.rolled_back, record.pending, sizeof(next.rolled_back));
    std::memset(next.pending, 0, sizeof(next.pending));
    next.booted = false;
    break;
  case BootAction::SkipPending:
    std::memcpy(next.skipped, record.pending, sizeof(next.skipped));
    std::memset(next.pending, 0, sizeof(next.pending));
    next.booted = false;
    break;
  }
  return next;
}

UpdateRecord apply_booted(const UpdateRecord &record)
{
  UpdateRecord next = record;
  if (record.pending[0] != '\0')
    next.booted = true;
  return next;
}

BootAction decide_confirmed_trial(const UpdateRecord &record, const char *running_version)
{
  if (record.pending[0] == '\0')
    return BootAction::Nothing;
  return std::strcmp(record.pending, running_version) == 0 ? BootAction::DropPending : BootAction::SkipPending;
}

UpdateRecord apply_confirmed(const UpdateRecord &record, const char *running_version)
{
  UpdateRecord next = apply_boot_action(record, decide_confirmed_trial(record, running_version));
  if (std::strcmp(next.skipped, running_version) == 0)
    std::memset(next.skipped, 0, sizeof(next.skipped));
  return next;
}

} // namespace update
} // namespace zenit
