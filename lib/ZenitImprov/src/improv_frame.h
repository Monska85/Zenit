// SPDX-License-Identifier: GPL-3.0-or-later

// Improv Wi-Fi Serial, version 1 (https://www.improv-wifi.com/serial/), as
// docs/board/wifi-and-updates-v1.md#setup-with-improv uses it. A frame is `IMPROV`, the version, a type, the length of
// the data, the data and a checksum (the sum of every earlier byte of the frame, modulo 256). The board ends each frame
// it sends with a newline, as clients that read line by line need; the checksum does not cover it.

#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace zenit
{
namespace improv
{

constexpr uint8_t VERSION = 1;
constexpr size_t HEADER_SIZE = 7; // `IMPROV` and the version
constexpr size_t MAX_DATA = 255;
// A frame that stops for this long is dropped.
constexpr uint32_t FRAME_IDLE_MS = 1000;

extern const char MAGIC[7]; // "IMPROV" and a NUL; the version byte follows on the wire

enum class Type : uint8_t
{
  CurrentState = 0x01,
  ErrorState = 0x02,
  RpcCommand = 0x03,
  RpcResult = 0x04
};

enum class State : uint8_t
{
  Ready = 0x02,
  Provisioning = 0x03,
  Provisioned = 0x04
};

enum class Error : uint8_t
{
  None = 0x00,
  InvalidRpc = 0x01,
  UnknownRpc = 0x02,
  UnableToConnect = 0x03
};

enum class Command : uint8_t
{
  WifiSettings = 0x01,
  CurrentState = 0x02,
  DeviceInfo = 0x03,
  ScanNetworks = 0x04
};

// A whole frame for the client, newline included.
std::string packet(Type type, const std::string &data);
std::string state_packet(State state);
std::string error_packet(Error error);
// An RPC result for `command` with these strings (each cut to 255 bytes, the whole to fit one frame).
std::string result_packet(Command command, const std::vector<std::string> &strings);

// The arguments of "send WiFi settings": the name's length, the name, the password's length, the password. False when
// they do not fit that layout or hold a NUL.
bool parse_wifi_settings(const std::string &args, std::string &ssid, std::string &password);

// Overwrites and empties a string that held a secret.
void wipe(std::string &text);

// Splits the bytes of the serial port into Improv frames and everything else. A frame starts at the beginning of a
// line with `IMPROV` and the version byte; its length then decides where it ends, whatever the bytes are. Every other
// byte is handed back to the protocol's line reader, in order.
class Demux
{
public:
  enum class Result : uint8_t
  {
    Consumed,    // the byte belongs to a frame in progress, or to a header that is not complete yet
    Passthrough, // pending() holds bytes for the line reader
    Frame,       // a complete frame with a good checksum: type() and data()
    BadChecksum  // a complete frame with a wrong checksum
  };

  Result feed(uint8_t byte, uint32_t now_ms);
  // Drops a frame that has stopped. Returns true when it did.
  bool idle(uint32_t now_ms);

  const uint8_t *pending() const { return pending_; }
  size_t pending_size() const { return pending_size_; }
  uint8_t type() const { return type_; }
  const std::string &data() const { return data_; }
  // Wipes the data of the last frame.
  void clear();

private:
  enum class Mode : uint8_t
  {
    LineStart, // the next byte starts a line
    Inside,    // in the middle of a line
    Header,    // matching `IMPROV` and the version
    Body       // type, length, data, checksum
  };

  Result pass(uint8_t byte);
  Mode mode_ = Mode::LineStart;
  uint8_t header_[HEADER_SIZE];
  size_t header_size_ = 0;
  uint8_t pending_[HEADER_SIZE + 1];
  size_t pending_size_ = 0;
  size_t seen_ = 0;
  uint8_t type_ = 0;
  uint8_t length_ = 0;
  uint8_t sum_ = 0;
  uint32_t last_byte_ms_ = 0;
  std::string data_;
};

} // namespace improv
} // namespace zenit
