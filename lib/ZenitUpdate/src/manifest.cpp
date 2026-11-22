// SPDX-License-Identifier: GPL-3.0-or-later

#include "manifest.h"

#include <ArduinoJson.h>
#include <proto_limits.h>
#include <strict_json.h>

#include <cstring>

#include "semver.h"

namespace zenit
{
namespace update
{

namespace
{
bool valid_file_name(const char *name)
{
  const size_t size = std::strlen(name);
  if (size < 1 || size > MAX_FILE_NAME || name[0] == '.')
    return false;
  for (size_t i = 0; i < size; i++)
  {
    const char c = name[i];
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-'))
      return false;
  }
  return true;
}

bool valid_sha256(const char *text)
{
  if (std::strlen(text) != 64)
    return false;
  for (size_t i = 0; i < 64; i++)
    if (!((text[i] >= '0' && text[i] <= '9') || (text[i] >= 'a' && text[i] <= 'f')))
      return false;
  return true;
}
} // namespace

bool parse_manifest(const char *json, size_t size, Manifest &out, const char *&why)
{
  if (size > MAX_MANIFEST)
  {
    why = "the manifest is too long";
    return false;
  }
  const char *reason = nullptr;
  size_t offset = 0;
  if (!proto::check_strict_object(json, size, proto::MAX_NESTING, reason, offset))
  {
    why = "the manifest is not strict JSON";
    return false;
  }
  JsonDocument doc;
  if (deserializeJson(doc, json, size))
  {
    why = "the manifest could not be read";
    return false;
  }
  JsonObjectConst object = doc.as<JsonObjectConst>();
  if (object.size() != 6)
  {
    why = "the manifest needs exactly six fields";
    return false;
  }
  JsonVariantConst schema = object["schema"];
  if (!schema.is<int64_t>() || schema.as<int64_t>() != 1)
  {
    why = "schema is not 1";
    return false;
  }
  JsonVariantConst board = object["board"], version = object["version"], file = object["file"], length = object["size"],
                   sha = object["sha256"];
  if (!board.is<const char *>() || std::strcmp(board.as<const char *>(), BOARD_ID) != 0)
  {
    why = "board is not esp32c3";
    return false;
  }
  if (!version.is<const char *>() || !is_release(version.as<const char *>()))
  {
    why = "version is not X.Y.Z";
    return false;
  }
  if (!file.is<const char *>() || !valid_file_name(file.as<const char *>()))
  {
    why = "file is not a plain file name";
    return false;
  }
  if (!length.is<int64_t>() || length.as<int64_t>() < MIN_FIRMWARE_SIZE || length.as<int64_t>() > SLOT_SIZE)
  {
    why = "size is out of range";
    return false;
  }
  if (!sha.is<const char *>() || !valid_sha256(sha.as<const char *>()))
  {
    why = "sha256 is not 64 lowercase hexadecimal digits";
    return false;
  }
  Manifest m;
  std::strcpy(m.version, version.as<const char *>());
  std::strcpy(m.file, file.as<const char *>());
  m.size = static_cast<uint32_t>(length.as<int64_t>());
  std::strcpy(m.sha256, sha.as<const char *>());
  out = m;
  return true;
}

bool firmware_url(const char *manifest_url, const Manifest &manifest, char *out, size_t size)
{
  const char *slash = std::strrchr(manifest_url, '/');
  if (!slash)
    return false;
  const size_t base = static_cast<size_t>(slash - manifest_url) + 1;
  const size_t name = std::strlen(manifest.file);
  if (base + name + 1 > size)
    return false;
  std::memcpy(out, manifest_url, base);
  std::memcpy(out + base, manifest.file, name + 1);
  return true;
}

} // namespace update
} // namespace zenit
