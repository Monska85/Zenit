// SPDX-License-Identifier: GPL-3.0-or-later

#include "request.h"

#include <cstdio>
#include <cstring>

#include "quote.h"

namespace zenit
{
namespace proto
{

Failure fail(const char *code, const char *message)
{
  Failure failure;
  failure.code = code;
  std::snprintf(failure.message, sizeof(failure.message), "%s", message);
  return failure;
}

Failure fail_field(const char *code, const char *prefix, const char *name)
{
  char quoted[48];
  quote_text(name, std::strlen(name), quoted, sizeof(quoted));
  Failure failure;
  failure.code = code;
  std::snprintf(failure.message, sizeof(failure.message), "%s \"%s\"", prefix, quoted);
  return failure;
}

Failure allow_only(JsonObjectConst request, std::initializer_list<const char *> names)
{
  for (JsonPairConst field : request)
  {
    bool known = field.key() == "seq" || field.key() == "cmd";
    for (const char *name : names)
      known = known || field.key() == name;
    if (!known)
      return fail_field("bad_request", "unknown field", field.key().c_str());
  }
  return {};
}

bool read_seq(JsonObjectConst request, uint32_t &seq)
{
  JsonVariantConst value = request["seq"];
  if (!value.is<uint32_t>())
    return false;
  seq = value.as<uint32_t>();
  return true;
}

} // namespace proto
} // namespace zenit
