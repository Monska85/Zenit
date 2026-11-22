// SPDX-License-Identifier: GPL-3.0-or-later

#include "update_status.h"

#include <cstring>

namespace zenit
{
namespace update
{

const char *state_name(State state)
{
  switch (state)
  {
  case State::Idle:
    return "idle";
  case State::Checking:
    return "checking";
  case State::Downloading:
    return "downloading";
  case State::Verifying:
    return "verifying";
  case State::Restarting:
    return "restarting";
  }
  return "idle";
}

const char *result_name(Result result)
{
  switch (result)
  {
  case Result::Never:
    return "never";
  case Result::UpToDate:
    return "up_to_date";
  case Result::Available:
    return "available";
  case Result::Skipped:
    return "skipped";
  case Result::Installed:
    return "installed";
  case Result::Incompatible:
    return "incompatible";
  case Result::NoNetwork:
    return "no_network";
  case Result::NoTime:
    return "no_time";
  case Result::Unreachable:
    return "unreachable";
  case Result::NotPublished:
    return "not_published";
  case Result::TlsError:
    return "tls_error";
  case Result::BadManifest:
    return "bad_manifest";
  case Result::BadDownload:
    return "bad_download";
  case Result::FlashError:
    return "flash_error";
  }
  return "never";
}

const char *web_state_name(WebState state)
{
  switch (state)
  {
  case WebState::Ok:
    return "ok";
  case WebState::Installing:
    return "installing";
  case WebState::Missing:
    return "missing";
  case WebState::Incompatible:
    return "incompatible";
  }
  return "missing";
}

bool speaks(uint8_t protocol_min, uint8_t protocol_max, uint8_t protocol)
{
  return protocol_min <= protocol && protocol <= protocol_max;
}

WebState judge_web_image(bool valid, uint8_t protocol_min, uint8_t protocol_max, uint8_t protocol)
{
  if (!valid)
    return WebState::Missing;
  return speaks(protocol_min, protocol_max, protocol) ? WebState::Ok : WebState::Incompatible;
}

bool is_failure(Result result) { return result >= Result::NoNetwork; }

Candidate judge(const char *running, const char *published, const char *skipped)
{
  Version have, offered;
  if (!parse_version(running, have) || !parse_version(published, offered))
    return Candidate::UpToDate;
  if (compare_versions(offered, have) <= 0)
    return Candidate::UpToDate;
  return skipped && skipped[0] && std::strcmp(published, skipped) == 0 ? Candidate::Skipped : Candidate::Available;
}

} // namespace update
} // namespace zenit
