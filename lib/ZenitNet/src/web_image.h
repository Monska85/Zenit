// SPDX-License-Identifier: GPL-3.0-or-later

// The web image in the `www` partition (docs/board/wifi-and-updates-v1.md#web-image): a header, an index and the
// gzipped files of the web app, read in place, and the order an install writes it in.

#pragma once

#include <cstddef>
#include <cstdint>

#include "net_http.h"
#include "sha256.h"

namespace zenit
{
namespace net
{

// The size of the `www` partition in partitions.csv.
constexpr uint32_t WEB_PARTITION_SIZE = 0x80000;
// The header takes the first flash sector, so an install can write it last on its own.
constexpr uint32_t WEB_HEADER_SIZE = 4096;
constexpr uint32_t WEB_SECTOR_SIZE = 4096;
constexpr uint32_t MIN_WEB_IMAGE = WEB_HEADER_SIZE + 1;
constexpr size_t MAX_WEB_FILES = 64;
constexpr size_t MAX_WEB_PATH = 127;
constexpr size_t MAX_WEB_MEDIA_TYPE = 63;
constexpr size_t WEB_VERSION_FIELD = 16;
constexpr uint8_t WEB_IMAGE_FORMAT = 1;

// The fields of a header that reads.
struct WebImageInfo
{
  char version[WEB_VERSION_FIELD + 1] = {0};
  uint8_t protocol_min = 0;
  uint8_t protocol_max = 0;
  uint16_t count = 0;
  uint32_t body_size = 0;
  uint8_t body_sha256[SHA256_SIZE] = {0};
};

// Reads the header (the first WEB_HEADER_SIZE bytes). False, with `why`, when the magic, the format, a reserved byte,
// the version text, the protocol range, the file count or the body size breaks its rule.
bool read_web_header(const uint8_t *header, size_t size, WebImageInfo &out, const char *&why);

// Reads a whole image of `size` bytes (at least the header and its body) in place: checks the header, the SHA-256 of
// the body and every index entry, and fills `assets` with pointers into `image`. False, with `why`, when anything
// breaks its rule; `assets` is then meaningless.
bool read_web_image(const uint8_t *image, size_t size, WebImageInfo &info, Asset (&assets)[MAX_WEB_FILES],
                    size_t &count, const char *&why);

// The flash the writer uses: offsets from the start of the partition.
class WebFlash
{
public:
  virtual bool erase(uint32_t offset, uint32_t size) = 0;
  virtual bool write(uint32_t offset, const uint8_t *data, size_t size) = 0;

protected:
  ~WebFlash() = default;
};

// Writes an image in the order that never leaves half of one readable. The header, the first bytes to arrive, is kept
// in memory and checked before anything is erased: it must read, be the `version` expected, speak `protocol` and
// announce a body that fills `size`. Only then is the old header erased; the body is written as it arrives (each sector
// erased just before its first byte), and the header is written last by `finish`. An image refused by its header leaves
// the old one as it was; a power cut or a failure after that leaves no header, so the partition reads as empty.
class WebWriter
{
public:
  // Starts an image of `size` bytes: false when the size is out of range. Nothing is erased yet.
  bool begin(WebFlash &flash, uint32_t size, const char *version, uint8_t protocol);
  // Appends bytes; false on a flash error or more bytes than `size`.
  bool write(const uint8_t *data, size_t size);
  // Writes the header once every byte arrived; false when bytes are missing or the write fails.
  bool finish();
  // Whether the image was refused by its header (nothing was erased).
  bool refused() const { return refused_; }

private:
  bool write_body(const uint8_t *data, size_t size);
  bool header_fits() const;

  WebFlash *flash_ = nullptr;
  uint32_t size_ = 0;
  uint32_t received_ = 0;
  uint32_t erased_until_ = 0;
  bool failed_ = true;
  bool refused_ = false;
  char version_[WEB_VERSION_FIELD + 1] = {0};
  uint8_t protocol_ = 0;
  uint8_t header_[WEB_HEADER_SIZE];
};

} // namespace net
} // namespace zenit
