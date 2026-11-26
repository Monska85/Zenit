// SPDX-License-Identifier: GPL-3.0-or-later

// Field rules shared by the commands (docs/protocol/protocol-v1.md#requests-and-replies).

#pragma once

#include <ArduinoJson.h>

#include <cstddef>
#include <cstdint>

namespace zenit
{
namespace proto
{

// The outcome of a check or a command: no `code` means success. `message` is for people.
struct Failure
{
  const char *code = nullptr;
  char message[96] = {0};
  explicit operator bool() const { return code != nullptr; }
};

// A failure with a fixed message (the text is cut to fit).
Failure fail(const char *code, const char *message);
// A failure that names a request field: `<prefix> "<name>"`, with the name quoted by quote_text().
Failure fail_field(const char *code, const char *prefix, const char *name);

// `bad_request` when the request has a field other than `seq`, `cmd` and the `count` entries of `names` (null entries
// name nothing).
Failure allow_only(JsonObjectConst request, const char *const *names, size_t count);

// The `seq` of a request: a whole number from 0 to 4,294,967,295.
bool read_seq(JsonObjectConst request, uint32_t &seq);

} // namespace proto
} // namespace zenit
