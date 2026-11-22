// SPDX-License-Identifier: GPL-3.0-or-later

#include "manifest.h"

#include <ArduinoJson.h>
#include <proto_limits.h>
#include <strict_json.h>
#include <web_image.h>

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

namespace
{
struct Rules
{
  bool web;
  size_t fields;
  int64_t min_size;
  int64_t max_size;
};

bool parse(const char *json, size_t size, const Rules &rules, Manifest &out, const char *&why)
{
  if (size > MAX_MANIFEST)
  {
    why = "the manifest is too long";
    return false;
  }
  // A file ends with a line break: one, LF or CRLF, is not part of the JSON.
  if (size > 0 && json[size - 1] == '\n')
    size -= size > 1 && json[size - 2] == '\r' ? 2 : 1;
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
  if (object.size() != rules.fields)
  {
    why = rules.web ? "the manifest needs exactly seven fields" : "the manifest needs exactly six fields";
    return false;
  }
  JsonVariantConst schema = object["schema"];
  if (!schema.is<int64_t>() || schema.as<int64_t>() != 1)
  {
    why = "schema is not 1";
    return false;
  }
  JsonVariantConst version = object["version"], file = object["file"], length = object["size"], sha = object["sha256"];
  if (!rules.web)
  {
    JsonVariantConst board = object["board"];
    if (!board.is<const char *>() || std::strcmp(board.as<const char *>(), BOARD_ID) != 0)
    {
      why = "board is not esp32c3";
      return false;
    }
  }
  if (!version.is<const char *>() || !is_release(version.as<const char *>()))
  {
    why = "version is not X.Y.Z";
    return false;
  }
  if (rules.web && std::strlen(version.as<const char *>()) > net::WEB_VERSION_FIELD)
  {
    why = "version is longer than a web image holds";
    return false;
  }
  if (!file.is<const char *>() || !valid_file_name(file.as<const char *>()))
  {
    why = "file is not a plain file name";
    return false;
  }
  if (!length.is<int64_t>() || length.as<int64_t>() < rules.min_size || length.as<int64_t>() > rules.max_size)
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
  if (rules.web)
  {
    JsonVariantConst low = object["protocol_min"], high = object["protocol_max"];
    if (!low.is<int64_t>() || !high.is<int64_t>() || low.as<int64_t>() < 1 || high.as<int64_t>() > 255 ||
        low.as<int64_t>() > high.as<int64_t>())
    {
      why = "the protocol range is not valid";
      return false;
    }
    m.protocol_min = static_cast<uint8_t>(low.as<int64_t>());
    m.protocol_max = static_cast<uint8_t>(high.as<int64_t>());
  }
  std::strcpy(m.version, version.as<const char *>());
  std::strcpy(m.file, file.as<const char *>());
  m.size = static_cast<uint32_t>(length.as<int64_t>());
  std::strcpy(m.sha256, sha.as<const char *>());
  out = m;
  return true;
}
} // namespace

bool parse_manifest(const char *json, size_t size, Manifest &out, const char *&why)
{
  return parse(json, size, {false, 6, MIN_FIRMWARE_SIZE, SLOT_SIZE}, out, why);
}

bool parse_web_manifest(const char *json, size_t size, Manifest &out, const char *&why)
{
  return parse(json, size, {true, 7, net::MIN_WEB_IMAGE, net::WEB_PARTITION_SIZE}, out, why);
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
