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
  Incompatible, // a newer web image that does not speak the firmware's protocol
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

enum class Candidate : uint8_t
{
  UpToDate,
  Available,
  Skipped
};

// The state of the web app in the `www` partition (docs/board/wifi-and-updates-v1.md#state-of-the-web-app).
enum class WebState : uint8_t
{
  Ok,
  Installing,
  Missing,
  Incompatible
};

const char *web_state_name(WebState state);
// The state of a partition whose image reads (`valid`) with the protocol range given, for a firmware that speaks
// `protocol`.
WebState judge_web_image(bool valid, uint8_t protocol_min, uint8_t protocol_max, uint8_t protocol);
// Whether an image with this protocol range works with a firmware that speaks `protocol`.
bool speaks(uint8_t protocol_min, uint8_t protocol_max, uint8_t protocol);

// What a published version is to the running one: not newer, newer, or newer but on the skip list. Versions that do
// not parse are not newer.
Candidate judge(const char *running, const char *published, const char *skipped);

} // namespace update
} // namespace zenit
