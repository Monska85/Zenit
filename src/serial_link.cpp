// SPDX-License-Identifier: GPL-3.0-or-later

#ifndef ZENIT_SIM

#include "serial_link.h"

#include <Arduino.h>
#include <line_reader.h>

#include "platform.h"
#include "protocol.h"

namespace serial_link
{

namespace
{
// Bytes taken from the port per call, so a flood of input cannot hold up the light's ticks.
constexpr size_t MAX_BYTES_PER_POLL = 512;

zenit::proto::LineReader reader;
uint32_t lowest_stack_free = UINT32_MAX;

void write_line(const char *line, size_t length)
{
  // One write, so the line never mixes with a log line. The flush sends it at once: without it the USB serial port of
  // the ESP32-C3 can hold the end of a long line until more output follows.
  Serial.write(reinterpret_cast<const uint8_t *>(line), length);
  Serial.flush();
}

// Reports each new low of the loop task's free stack, so a test on the board finds how much of the 8 KiB is used.
void report_stack()
{
  const uint32_t free_bytes = platform::stack_free_min();
  if (free_bytes < lowest_stack_free)
  {
    lowest_stack_free = free_bytes;
    platform::log("loop stack: %u bytes free at the lowest", static_cast<unsigned>(free_bytes));
  }
}
} // namespace

void poll(uint64_t now)
{
  for (size_t n = 0; n < MAX_BYTES_PER_POLL && Serial.available() > 0; n++)
  {
    const int byte = Serial.read();
    if (byte < 0)
      return;
    switch (reader.feed(static_cast<uint8_t>(byte)))
    {
    case zenit::proto::LineReader::Event::None:
      break;
    case zenit::proto::LineReader::Event::Line:
      protocol::handle_line(protocol::Transport::Usb, reader.line(), reader.length(), now, write_line);
      report_stack();
      return;
    case zenit::proto::LineReader::Event::TooLong:
      protocol::line_too_long(protocol::Transport::Usb, write_line);
      return;
    }
  }
}

} // namespace serial_link

#endif
