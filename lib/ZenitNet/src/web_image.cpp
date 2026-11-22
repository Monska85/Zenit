// SPDX-License-Identifier: GPL-3.0-or-later

#include "web_image.h"

#include <cstring>

namespace zenit
{
namespace net
{

namespace
{
const uint8_t MAGIC[4] = {'Z', 'W', 'E', 'B'};
// The header's fields end here; the rest of the sector is zero.
constexpr size_t HEADER_FIELDS = 64;

uint16_t u16(const uint8_t *p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }
uint32_t u32(const uint8_t *p)
{
  return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) | (static_cast<uint32_t>(p[2]) << 16) |
         (static_cast<uint32_t>(p[3]) << 24);
}

// A release version, X.Y.Z: three whole numbers of at most six digits, without leading zeros, separated by dots (the
// update rules' versions).
bool plain_version(const char *text)
{
  for (int part = 0; part < 3; part++)
  {
    if (!(*text >= '0' && *text <= '9'))
      return false;
    const bool zero = *text == '0';
    const char *start = text;
    while (*text >= '0' && *text <= '9')
      text++;
    if ((zero && text - start > 1) || text - start > 6)
      return false;
    if (part < 2 && *text++ != '.')
      return false;
  }
  return *text == '\0';
}

// A path the board can serve: printable ASCII without a backslash, no leading slash and no `..`.
bool servable_path(const char *path, size_t size)
{
  if (size == 0 || size > MAX_WEB_PATH || path[0] == '/')
    return false;
  for (size_t i = 0; i < size; i++)
  {
    const unsigned char c = static_cast<unsigned char>(path[i]);
    if (c < 0x21 || c > 0x7E || c == '\\')
      return false;
  }
  return std::strstr(path, "..") == nullptr;
}

bool media_type(const char *text, size_t size)
{
  if (size == 0 || size > MAX_WEB_MEDIA_TYPE)
    return false;
  for (size_t i = 0; i < size; i++)
    if (static_cast<unsigned char>(text[i]) < 0x20 || static_cast<unsigned char>(text[i]) > 0x7E)
      return false;
  return true;
}

bool fail(const char *&why, const char *reason)
{
  why = reason;
  return false;
}
} // namespace

bool read_web_header(const uint8_t *header, size_t size, WebImageInfo &out, const char *&why)
{
  if (!header || size < WEB_HEADER_SIZE)
    return fail(why, "no header");
  if (std::memcmp(header, MAGIC, sizeof(MAGIC)) != 0)
    return fail(why, "no web image");
  if (header[4] != WEB_IMAGE_FORMAT)
    return fail(why, "unknown image format");
  if (header[7] != 0 || header[26] != 0 || header[27] != 0)
    return fail(why, "a reserved byte is not zero");
  for (size_t i = HEADER_FIELDS; i < WEB_HEADER_SIZE; i++)
    if (header[i] != 0)
      return fail(why, "the header is not zero after its fields");
  WebImageInfo info;
  const uint8_t *version = header + 8;
  size_t length = 0;
  while (length < WEB_VERSION_FIELD && version[length] != 0)
    length++;
  for (size_t i = length; i < WEB_VERSION_FIELD; i++)
    if (version[i] != 0)
      return fail(why, "the version is not zero-padded");
  std::memcpy(info.version, version, length);
  if (length == 0 || !plain_version(info.version))
    return fail(why, "the version is not a release");
  info.protocol_min = header[5];
  info.protocol_max = header[6];
  if (info.protocol_min == 0 || info.protocol_min > info.protocol_max)
    return fail(why, "the protocol range is not valid");
  info.count = u16(header + 24);
  if (info.count == 0 || info.count > MAX_WEB_FILES)
    return fail(why, "the file count is out of range");
  info.body_size = u32(header + 28);
  if (info.body_size == 0 || info.body_size > WEB_PARTITION_SIZE - WEB_HEADER_SIZE)
    return fail(why, "the body size is out of range");
  std::memcpy(info.body_sha256, header + 32, SHA256_SIZE);
  out = info;
  return true;
}

bool read_web_image(const uint8_t *image, size_t size, WebImageInfo &info, Asset (&assets)[MAX_WEB_FILES],
                    size_t &count, const char *&why)
{
  count = 0;
  if (!read_web_header(image, size, info, why))
    return false;
  if (size - WEB_HEADER_SIZE < info.body_size)
    return fail(why, "the body is cut short");
  const uint8_t *body = image + WEB_HEADER_SIZE;
  Sha256 hash;
  hash.update(body, info.body_size);
  uint8_t digest[SHA256_SIZE];
  hash.finish(digest);
  if (std::memcmp(digest, info.body_sha256, SHA256_SIZE) != 0)
    return fail(why, "the body does not match its SHA-256");

  // The index: per file the path and the media type, each a length, the text and a NUL, then offset and length.
  size_t at = 0;
  const size_t end = info.body_size;
  bool has_index = false;
  for (size_t n = 0; n < info.count; n++)
  {
    const char *texts[2];
    for (int t = 0; t < 2; t++)
    {
      if (at >= end)
        return fail(why, "the index is cut short");
      const size_t length = body[at];
      if (at + 1 + length + 1 > end || body[at + 1 + length] != 0)
        return fail(why, "an index text is not terminated");
      const char *text = reinterpret_cast<const char *>(body + at + 1);
      if (std::memchr(text, 0, length) != nullptr)
        return fail(why, "an index text holds a NUL");
      if (t == 0 ? !servable_path(text, length) : !media_type(text, length))
        return fail(why, t == 0 ? "a path cannot be served" : "a media type is not valid");
      texts[t] = text;
      at += 1 + length + 1;
    }
    if (at + 8 > end)
      return fail(why, "the index is cut short");
    const uint32_t offset = u32(body + at), length = u32(body + at + 4);
    at += 8;
    for (size_t k = 0; k < n; k++)
      if (std::strcmp(assets[k].path, texts[0]) == 0)
        return fail(why, "a path is named twice");
    if (offset > end || length > end - offset)
      return fail(why, "a file lies outside the body");
    // Whether a file starts after the index is checked once the index's end is known.
    assets[n] = {texts[0], texts[1], body + offset, length, std::strncmp(texts[0], "assets/", 7) == 0};
    if (std::strcmp(texts[0], "index.html") == 0)
      has_index = true;
  }
  for (size_t n = 0; n < info.count; n++)
    if (assets[n].data < body + at)
      return fail(why, "a file overlaps the index");
  if (!has_index)
    return fail(why, "index.html is missing");
  count = info.count;
  return true;
}

bool WebWriter::begin(WebFlash &flash, uint32_t size, const char *version, uint8_t protocol)
{
  flash_ = &flash;
  size_ = size;
  received_ = 0;
  refused_ = false;
  // The first erase takes the old header with the first body sector, once the new header has been checked.
  erased_until_ = 0;
  protocol_ = protocol;
  failed_ = size < MIN_WEB_IMAGE || size > WEB_PARTITION_SIZE || !version || std::strlen(version) > WEB_VERSION_FIELD;
  if (!failed_)
    std::strcpy(version_, version);
  return !failed_;
}

bool WebWriter::header_fits() const
{
  WebImageInfo info;
  const char *why = "";
  return read_web_header(header_, WEB_HEADER_SIZE, info, why) && std::strcmp(info.version, version_) == 0 &&
         info.protocol_min <= protocol_ && protocol_ <= info.protocol_max && WEB_HEADER_SIZE + info.body_size == size_;
}

bool WebWriter::write_body(const uint8_t *data, size_t size)
{
  const uint32_t offset = received_;
  const uint32_t end = offset + static_cast<uint32_t>(size);
  if (end > erased_until_)
  {
    const uint32_t upto = (end + WEB_SECTOR_SIZE - 1) / WEB_SECTOR_SIZE * WEB_SECTOR_SIZE;
    if (!flash_->erase(erased_until_, upto - erased_until_))
      return false;
    erased_until_ = upto;
  }
  return flash_->write(offset, data, size);
}

bool WebWriter::write(const uint8_t *data, size_t size)
{
  if (failed_ || size > size_ - received_)
  {
    failed_ = true;
    return false;
  }
  while (size > 0)
  {
    size_t part;
    if (received_ < WEB_HEADER_SIZE)
    {
      part = WEB_HEADER_SIZE - received_ < size ? WEB_HEADER_SIZE - received_ : size;
      std::memcpy(header_ + received_, data, part);
      // The whole header is here: it decides before the flash changes.
      if (received_ + part == WEB_HEADER_SIZE && !header_fits())
      {
        failed_ = refused_ = true;
        return false;
      }
    }
    else
    {
      part = size;
      if (!write_body(data, part))
      {
        failed_ = true;
        return false;
      }
    }
    received_ += static_cast<uint32_t>(part);
    data += part;
    size -= part;
  }
  return true;
}

bool WebWriter::finish()
{
  if (failed_ || received_ != size_)
    return false;
  failed_ = true; // one finish per image
  return flash_->write(0, header_, WEB_HEADER_SIZE);
}

} // namespace net
} // namespace zenit
