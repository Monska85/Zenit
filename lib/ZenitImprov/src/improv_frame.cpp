// SPDX-License-Identifier: GPL-3.0-or-later

#include "improv_frame.h"

#include <algorithm>
#include <cstring>

namespace zenit
{
namespace improv
{

const char MAGIC[7] = {'I', 'M', 'P', 'R', 'O', 'V', 0};

namespace
{
const uint8_t HEADER[HEADER_SIZE] = {'I', 'M', 'P', 'R', 'O', 'V', VERSION};
}

std::string packet(Type type, const std::string &data)
{
  std::string out(MAGIC, 6);
  out += static_cast<char>(VERSION);
  out += static_cast<char>(type);
  out += static_cast<char>(data.size());
  out += data;
  uint8_t sum = 0;
  for (char c : out)
    sum = static_cast<uint8_t>(sum + static_cast<uint8_t>(c));
  out += static_cast<char>(sum);
  out += '\n';
  return out;
}

std::string state_packet(State state) { return packet(Type::CurrentState, std::string(1, static_cast<char>(state))); }

std::string error_packet(Error error) { return packet(Type::ErrorState, std::string(1, static_cast<char>(error))); }

std::string result_packet(Command command, const std::vector<std::string> &strings)
{
  std::string body;
  for (const std::string &s : strings)
  {
    const size_t size = std::min<size_t>(s.size(), 255);
    if (body.size() + 1 + size > MAX_DATA - 2)
      break;
    body += static_cast<char>(size);
    body.append(s, 0, size);
  }
  std::string data;
  data += static_cast<char>(command);
  data += static_cast<char>(body.size());
  data += body;
  return packet(Type::RpcResult, data);
}

bool parse_wifi_settings(const std::string &args, std::string &ssid, std::string &password)
{
  if (args.empty())
    return false;
  const size_t ssid_size = static_cast<uint8_t>(args[0]);
  if (ssid_size < 1 || ssid_size > 32 || args.size() < 1 + ssid_size + 1)
    return false;
  const size_t password_size = static_cast<uint8_t>(args[1 + ssid_size]);
  if (password_size > 64 || args.size() != 1 + ssid_size + 1 + password_size)
    return false;
  ssid = args.substr(1, ssid_size);
  password = args.substr(2 + ssid_size, password_size);
  return ssid.find('\0') == std::string::npos && password.find('\0') == std::string::npos;
}

void wipe(std::string &text)
{
  volatile char *p = text.empty() ? nullptr : &text[0];
  for (size_t i = 0; i < text.size(); i++)
    p[i] = 0;
  text.clear();
}

void Demux::clear() { wipe(data_); }

Demux::Result Demux::pass(uint8_t byte)
{
  // The held header bytes first, then this one, so the line reader sees every byte in order.
  std::memcpy(pending_, header_, header_size_);
  pending_[header_size_] = byte;
  pending_size_ = header_size_ + 1;
  header_size_ = 0;
  mode_ = byte == '\n' ? Mode::LineStart : Mode::Inside;
  return Result::Passthrough;
}

Demux::Result Demux::feed(uint8_t byte, uint32_t now_ms)
{
  last_byte_ms_ = now_ms;
  pending_size_ = 0;
  switch (mode_)
  {
  case Mode::LineStart:
  case Mode::Inside:
    if (mode_ == Mode::LineStart && byte == HEADER[0])
    {
      header_[0] = byte;
      header_size_ = 1;
      mode_ = Mode::Header;
      return Result::Consumed;
    }
    return pass(byte);
  case Mode::Header:
    if (byte == HEADER[header_size_])
    {
      header_[header_size_++] = byte;
      if (header_size_ == HEADER_SIZE)
      {
        header_size_ = 0;
        mode_ = Mode::Body;
        seen_ = 0;
        type_ = 0;
        length_ = 0;
        sum_ = 0;
        for (uint8_t b : HEADER)
          sum_ = static_cast<uint8_t>(sum_ + b);
        wipe(data_);
      }
      return Result::Consumed;
    }
    return pass(byte);
  case Mode::Body:
  {
    const size_t at = seen_++;
    if (at == 0)
    {
      type_ = byte;
      sum_ = static_cast<uint8_t>(sum_ + byte);
    }
    else if (at == 1)
    {
      length_ = byte;
      sum_ = static_cast<uint8_t>(sum_ + byte);
    }
    else if (at < 2u + length_)
    {
      data_ += static_cast<char>(byte);
      sum_ = static_cast<uint8_t>(sum_ + byte);
    }
    else
    {
      // The end of a frame counts as the start of a line: the next frame may follow with no newline between.
      mode_ = Mode::LineStart;
      if (byte == sum_)
        return Result::Frame;
      wipe(data_);
      return Result::BadChecksum;
    }
    return Result::Consumed;
  }
  }
  return Result::Consumed;
}

bool Demux::idle(uint32_t now_ms)
{
  if ((mode_ == Mode::Header || mode_ == Mode::Body) && now_ms - last_byte_ms_ >= FRAME_IDLE_MS)
  {
    wipe(data_);
    header_size_ = 0;
    mode_ = Mode::LineStart;
    return true;
  }
  return false;
}

} // namespace improv
} // namespace zenit
