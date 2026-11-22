// SPDX-License-Identifier: GPL-3.0-or-later

// The names of the update states and results (docs/board/wifi-and-updates-v1.md#status) and the rule that tells a
// version worth installing.

#pragma once

#include <cstdint>

#include "semver.h"

namespace zenit
{
namespace update
{

enum class State : uint8_t
{
  Idle,
  Checking,
  Downloading,
  Verifying,
  Restarting
};

enum class Result : uint8_t
{
  Never,
  UpToDate,
  Available,
  Skipped,
  Installed,
  NoNetwork,
  NoTime,
  Unreachable,
  NotPublished,
  TlsError,
  BadManifest,
  BadDownload,
  FlashError
};

const char *state_name(State state);
const char *result_name(Result result);
// A result that is a failed check: it is tried again after 30 minutes.
bool is_failure(Result result);

enum class Candidate : uint8_t
{
  UpToDate,
  Available,
  Skipped
};

// What a published version is to the running one: not newer, newer, or newer but on the skip list. Versions that do
// not parse are not newer.
Candidate judge(const char *running, const char *published, const char *skipped);

} // namespace update
} // namespace zenit
