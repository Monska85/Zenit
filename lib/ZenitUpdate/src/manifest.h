// SPDX-License-Identifier: GPL-3.0-or-later

// The update manifest (docs/board/wifi-and-updates-v1.md#source): strict JSON with exactly these fields.

#pragma once

#include <cstddef>
#include <cstdint>

namespace zenit
{
namespace update
{

constexpr size_t MAX_MANIFEST = 1024;
constexpr size_t MAX_FILE_NAME = 64;
// The longest URL the board builds, in characters. The longest URL is the firmware file: the site address, `firmware/`
// and a file name of MAX_FILE_NAME characters. A site address longer than MAX_SITE_URL cannot be built with: the
// firmware refuses it at compile time (include/site.h) and tools/site_url.py at build time, which reads this value.
constexpr size_t MAX_URL = 255;
constexpr size_t MAX_SITE_URL = MAX_URL - (sizeof("firmware/") - 1) - MAX_FILE_NAME;
constexpr uint32_t MIN_FIRMWARE_SIZE = 65536;
// The size of an application slot in partitions.csv.
constexpr uint32_t SLOT_SIZE = 0x1F0000;
constexpr const char *BOARD_ID = "esp32c3";

struct Manifest
{
  char version[48] = {0};
  char file[MAX_FILE_NAME + 1] = {0};
  uint32_t size = 0;
  char sha256[65] = {0};
};

// Reads a manifest. False when it is longer than MAX_MANIFEST, is not strict JSON, lacks a field, has another one, or
// has a value that breaks its rule. `why` names the first problem, for the log.
bool parse_manifest(const char *json, size_t size, Manifest &out, const char *&why);

// The address of the firmware file: the manifest's address up to its last `/`, then the file name. False when it does
// not fit.
bool firmware_url(const char *manifest_url, const Manifest &manifest, char *out, size_t size);

} // namespace update
} // namespace zenit
