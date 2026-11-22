// SPDX-License-Identifier: GPL-3.0-or-later

// The board settings of docs/protocol/protocol-v1.md#settings_get-settings_set and their stored record
// (docs/board/wifi-and-updates-v1.md#stored-settings): WiFi, updates, time and network login, with the WiFi
// credentials and the token.

#pragma once

#include <cstddef>
#include <cstdint>

namespace zenit
{
namespace net
{

enum class WifiPower : uint8_t
{
  Auto = 0,
  Dbm8_5,
  Dbm11,
  Dbm13,
  Dbm15,
  Dbm17,
  Dbm18_5,
  Dbm19_5
};
constexpr size_t WIFI_POWER_COUNT = 8;

enum class UpdateMode : uint8_t
{
  Off = 0,
  Notify,
  Automatic
};
constexpr size_t UPDATE_MODE_COUNT = 3;

constexpr size_t MAX_TIMEZONE = 64;
constexpr size_t MAX_NTP_SERVER = 64;
constexpr size_t TOKEN_SIZE = 16;
constexpr size_t MAX_SSID = 32;
constexpr size_t MAX_PASSWORD = 64;
constexpr uint16_t MINUTES_PER_DAY = 1440;

struct BoardSettings
{
  WifiPower wifi_power = WifiPower::Auto;
  UpdateMode update_mode = UpdateMode::Automatic;
  bool update_firmware = true;
  uint8_t check_hours = 6;
  uint16_t install_start = 0;
  uint16_t install_end = 0;
  uint8_t time_sync_hours = 6;
  bool network_login = false;
  char timezone[MAX_TIMEZONE + 1] = "UTC0";
  char ntp_server[MAX_NTP_SERVER + 1] = "pool.ntp.org";
  // Empty until the first start makes one.
  char token[TOKEN_SIZE + 1] = {0};
  // The stored network: an empty name means none.
  char wifi_ssid[MAX_SSID + 1] = {0};
  char wifi_password[MAX_PASSWORD + 1] = {0};
};

bool operator==(const BoardSettings &a, const BoardSettings &b);
inline bool operator!=(const BoardSettings &a, const BoardSettings &b) { return !(a == b); }

// Names as the protocol writes them.
const char *wifi_power_name(WifiPower power);
bool wifi_power_from_name(const char *name, WifiPower &out);
// The power in quarters of dBm, as the radio takes it (`auto` is the maximum).
int wifi_power_quarter_dbm(WifiPower power);
const char *update_mode_name(UpdateMode mode);
bool update_mode_from_name(const char *name, UpdateMode &out);

bool valid_check_hours(int64_t hours);
bool valid_minute_of_day(int64_t minute);
bool valid_time_sync_hours(int64_t hours);
bool valid_timezone(const char *text);
bool valid_ntp_server(const char *text);
bool valid_token(const char *text);
// A network name: 1 to 32 bytes of valid UTF-8 with no control character (C0 or DEL), so it can be reported in JSON as
// it is.
bool valid_wifi_name(const char *text);
// The same rule for `size` bytes that may hold a NUL (a NUL is a control character, so it is refused): the length is
// the length of the original name, never of a copy cut to fit.
bool valid_wifi_name_bytes(const char *text, size_t size);
// Empty (an open network), 8 to 63 characters, or 64 hexadecimal digits.
bool valid_wifi_password(const char *text);

// Fills `settings.token` with 16 characters of a-z and 0-9, each equally likely: bytes from `random` that would bias
// the draw are skipped and more are asked for.
using RandomBytes = void (*)(uint8_t *out, size_t size);
void make_token(char (&token)[TOKEN_SIZE + 1], RandomBytes random);

constexpr uint8_t BOARD_RECORD_VERSION = 1;
constexpr size_t BOARD_RECORD_SIZE = 255;

void encode_board_record(const BoardSettings &settings, uint8_t (&out)[BOARD_RECORD_SIZE]);

// The settings of a record. A record of another size or version gives the defaults and an empty token; a field out of
// its range keeps its default. `settings.token` is empty when the stored one is not valid. Returns false for a record
// that was not used as a whole.
bool decode_board_record(const uint8_t *record, size_t size, BoardSettings &settings);

} // namespace net
} // namespace zenit
