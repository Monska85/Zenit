// SPDX-License-Identifier: GPL-3.0-or-later

#include "board_settings.h"

#include <cstring>

#include "utf8.h"

namespace zenit
{
namespace net
{

namespace
{
struct PowerEntry
{
  const char *name;
  int quarter_dbm;
};
// The order is the stored code.
const PowerEntry POWERS[WIFI_POWER_COUNT] = {{"auto", 78}, {"8.5", 34}, {"11", 44},   {"13", 52},
                                             {"15", 60},   {"17", 68},  {"18.5", 74}, {"19.5", 78}};
const char *const MODES[UPDATE_MODE_COUNT] = {"off", "notify", "automatic"};

bool is_letter_or_digit(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'); }

// Copies a stored text of `length` bytes out of a record field of `capacity`; false when it does not fit.
bool read_text(const uint8_t *field, size_t capacity, size_t length, char *out, size_t out_size)
{
  if (length > capacity || length >= out_size)
    return false;
  std::memcpy(out, field, length);
  out[length] = '\0';
  return std::strlen(out) == length;
}
} // namespace

bool operator==(const BoardSettings &a, const BoardSettings &b)
{
  return a.wifi_power == b.wifi_power && a.update_mode == b.update_mode && a.update_firmware == b.update_firmware &&
         a.check_hours == b.check_hours && a.install_start == b.install_start && a.install_end == b.install_end &&
         a.time_sync_hours == b.time_sync_hours && a.network_login == b.network_login &&
         std::strcmp(a.timezone, b.timezone) == 0 && std::strcmp(a.ntp_server, b.ntp_server) == 0 &&
         std::strcmp(a.token, b.token) == 0 && std::strcmp(a.wifi_ssid, b.wifi_ssid) == 0 &&
         std::strcmp(a.wifi_password, b.wifi_password) == 0;
}

const char *wifi_power_name(WifiPower power) { return POWERS[static_cast<size_t>(power)].name; }

bool wifi_power_from_name(const char *name, WifiPower &out)
{
  for (size_t i = 0; i < WIFI_POWER_COUNT; i++)
    if (std::strcmp(name, POWERS[i].name) == 0)
    {
      out = static_cast<WifiPower>(i);
      return true;
    }
  return false;
}

int wifi_power_quarter_dbm(WifiPower power) { return POWERS[static_cast<size_t>(power)].quarter_dbm; }

const char *update_mode_name(UpdateMode mode) { return MODES[static_cast<size_t>(mode)]; }

bool update_mode_from_name(const char *name, UpdateMode &out)
{
  for (size_t i = 0; i < UPDATE_MODE_COUNT; i++)
    if (std::strcmp(name, MODES[i]) == 0)
    {
      out = static_cast<UpdateMode>(i);
      return true;
    }
  return false;
}

bool valid_check_hours(int64_t hours) { return hours >= 1 && hours <= 168; }
bool valid_minute_of_day(int64_t minute) { return minute >= 0 && minute < MINUTES_PER_DAY; }
bool valid_time_sync_hours(int64_t hours) { return hours >= 1 && hours <= 168; }

bool valid_timezone(const char *text)
{
  const size_t size = std::strlen(text);
  if (size < 1 || size > MAX_TIMEZONE)
    return false;
  for (size_t i = 0; i < size; i++)
    if (static_cast<unsigned char>(text[i]) <= 0x20 || static_cast<unsigned char>(text[i]) > 0x7e)
      return false;
  return true;
}

bool valid_ntp_server(const char *text)
{
  const size_t size = std::strlen(text);
  if (size < 1 || size > MAX_NTP_SERVER)
    return false;
  for (size_t i = 0; i < size; i++)
    if (!is_letter_or_digit(text[i]) && text[i] != '.' && text[i] != '-')
      return false;
  return true;
}

bool valid_token(const char *text)
{
  if (std::strlen(text) != TOKEN_SIZE)
    return false;
  for (size_t i = 0; i < TOKEN_SIZE; i++)
    if (!((text[i] >= 'a' && text[i] <= 'z') || (text[i] >= '0' && text[i] <= '9')))
      return false;
  return true;
}

bool valid_wifi_name_bytes(const char *text, size_t size)
{
  if (size < 1 || size > MAX_SSID)
    return false;
  for (size_t i = 0; i < size;)
  {
    const unsigned char c = static_cast<unsigned char>(text[i]);
    // Valid UTF-8 without control characters (C0 and DEL), so the name is the same text in JSON on every client
    if (c < 0x20 || c == 0x7f)
      return false;
    const size_t length = utf8_sequence_length(text, size, i);
    if (length == 0)
      return false;
    i += length;
  }
  return true;
}

bool valid_wifi_name(const char *text) { return valid_wifi_name_bytes(text, std::strlen(text)); }

bool valid_wifi_password(const char *text)
{
  const size_t size = std::strlen(text);
  if (size == 0 || (size >= 8 && size <= 63))
    return true;
  if (size != 64)
    return false;
  for (size_t i = 0; i < size; i++)
  {
    const char c = text[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')))
      return false;
  }
  return true;
}

void make_token(char (&token)[TOKEN_SIZE + 1], RandomBytes random)
{
  static const char SYMBOLS[] = "abcdefghijklmnopqrstuvwxyz0123456789";
  size_t made = 0;
  while (made < TOKEN_SIZE)
  {
    uint8_t bytes[TOKEN_SIZE];
    random(bytes, sizeof(bytes));
    for (size_t i = 0; i < sizeof(bytes) && made < TOKEN_SIZE; i++)
      // 252 is the largest multiple of 36 up to 256: higher bytes would favor the first symbols.
      if (bytes[i] < 252)
        token[made++] = SYMBOLS[bytes[i] % 36];
  }
  token[TOKEN_SIZE] = '\0';
}

void encode_board_record(const BoardSettings &s, uint8_t (&out)[BOARD_RECORD_SIZE])
{
  std::memset(out, 0, BOARD_RECORD_SIZE);
  out[0] = BOARD_RECORD_VERSION;
  out[1] = static_cast<uint8_t>(s.wifi_power);
  out[2] = static_cast<uint8_t>(s.update_mode);
  out[3] = s.update_firmware ? 1 : 0;
  out[4] = s.check_hours;
  out[5] = s.install_start & 0xFF;
  out[6] = s.install_start >> 8;
  out[7] = s.install_end & 0xFF;
  out[8] = s.install_end >> 8;
  out[9] = s.time_sync_hours;
  out[10] = s.network_login ? 1 : 0;
  out[11] = static_cast<uint8_t>(std::strlen(s.timezone));
  std::memcpy(out + 12, s.timezone, std::strlen(s.timezone));
  out[76] = static_cast<uint8_t>(std::strlen(s.ntp_server));
  std::memcpy(out + 77, s.ntp_server, std::strlen(s.ntp_server));
  std::memcpy(out + 141, s.token, std::strlen(s.token) == TOKEN_SIZE ? TOKEN_SIZE : 0);
  out[157] = static_cast<uint8_t>(std::strlen(s.wifi_ssid));
  std::memcpy(out + 158, s.wifi_ssid, std::strlen(s.wifi_ssid));
  out[190] = static_cast<uint8_t>(std::strlen(s.wifi_password));
  std::memcpy(out + 191, s.wifi_password, std::strlen(s.wifi_password));
}

bool decode_board_record(const uint8_t *in, size_t size, BoardSettings &s)
{
  s = BoardSettings();
  if (!in || size != BOARD_RECORD_SIZE || in[0] != BOARD_RECORD_VERSION)
    return false;
  if (in[1] < WIFI_POWER_COUNT)
    s.wifi_power = static_cast<WifiPower>(in[1]);
  if (in[2] < UPDATE_MODE_COUNT)
    s.update_mode = static_cast<UpdateMode>(in[2]);
  if (in[3] <= 1)
    s.update_firmware = in[3] == 1;
  if (valid_check_hours(in[4]))
    s.check_hours = in[4];
  const uint16_t start = in[5] | (in[6] << 8), end = in[7] | (in[8] << 8);
  if (valid_minute_of_day(start) && valid_minute_of_day(end))
  {
    s.install_start = start;
    s.install_end = end;
  }
  if (valid_time_sync_hours(in[9]))
    s.time_sync_hours = in[9];
  if (in[10] <= 1)
    s.network_login = in[10] == 1;
  char text[MAX_PASSWORD + 1];
  if (read_text(in + 12, 64, in[11], text, sizeof(text)) && valid_timezone(text))
    std::strcpy(s.timezone, text);
  if (read_text(in + 77, 64, in[76], text, sizeof(text)) && valid_ntp_server(text))
    std::strcpy(s.ntp_server, text);
  if (read_text(in + 141, TOKEN_SIZE, TOKEN_SIZE, text, sizeof(text)) && valid_token(text))
    std::strcpy(s.token, text);
  char name[MAX_SSID + 1];
  if (read_text(in + 158, MAX_SSID, in[157], name, sizeof(name)) && (in[157] == 0 || valid_wifi_name(name)) &&
      read_text(in + 191, 64, in[190], text, sizeof(text)) && valid_wifi_password(text))
  {
    std::strcpy(s.wifi_ssid, name);
    std::strcpy(s.wifi_password, text);
  }
  return true;
}

} // namespace net
} // namespace zenit
