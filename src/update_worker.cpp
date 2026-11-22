// SPDX-License-Identifier: GPL-3.0-or-later

#include "update_worker.h"

#include "platform.h"
#include "update_http.h"

namespace update_worker
{

using zenit::update::Result;

namespace
{
Result result_of(update_http::Outcome outcome)
{
  switch (outcome)
  {
  case update_http::Outcome::Ok:
    return Result::Installed;
  case update_http::Outcome::Unreachable:
    return Result::Unreachable;
  case update_http::Outcome::NotPublished:
    return Result::NotPublished;
  case update_http::Outcome::TlsError:
    return Result::TlsError;
  case update_http::Outcome::BadDownload:
    return Result::BadDownload;
  case update_http::Outcome::FlashError:
    return Result::FlashError;
  }
  return Result::Unreachable;
}
} // namespace

CheckResult check(const char *manifest_url)
{
  CheckResult out;
  char body[zenit::update::MAX_MANIFEST + 1];
  size_t size = 0;
  const update_http::Outcome outcome =
      update_http::fetch_manifest(manifest_url, body, zenit::update::MAX_MANIFEST, size);
  if (outcome == update_http::Outcome::BadDownload)
    out.result = Result::BadManifest;
  else if (outcome != update_http::Outcome::Ok)
    out.result = result_of(outcome);
  else
  {
    const char *why = nullptr;
    if (!zenit::update::parse_manifest(body, size, out.manifest, why))
    {
      platform::log("update manifest refused: %s", why);
      out.result = Result::BadManifest;
    }
  }
  return out;
}

Result download(const char *manifest_url, const zenit::update::Manifest &manifest, void (*progress)(uint8_t))
{
  char url[zenit::update::MAX_URL + 1];
  if (!zenit::update::firmware_url(manifest_url, manifest, url, sizeof(url)))
    return Result::BadManifest;
  return result_of(update_http::download_firmware(url, manifest.size, manifest.sha256, progress));
}

} // namespace update_worker
