// SPDX-License-Identifier: GPL-3.0-or-later

#include "line_reader.h"

#include "frame.h"

namespace zenit
{
namespace proto
{

void LineReader::clear()
{
  length_ = 0;
  overflowed_ = false;
  marker_ = false;
  complete_ = false;
}

LineReader::Event LineReader::feed(uint8_t byte)
{
  if (complete_)
    clear();
  if (byte != '\n')
  {
    if (length_ < MAX_LINE + 1)
      line_[length_++] = static_cast<char>(byte);
    else
      overflowed_ = true;
    if (length_ == FRAME_MARKER_SIZE && !overflowed_)
      marker_ = has_marker(line_, length_);
    return Event::None;
  }

  if (length_ > 0 && strip_cr_ && line_[length_ - 1] == '\r' && !overflowed_)
    length_--;
  const bool too_long = overflowed_ || length_ > MAX_LINE;
  const bool marker = marker_;
  if (too_long)
  {
    clear();
    return marker ? Event::TooLong : Event::None;
  }
  line_[length_] = '\0';
  complete_ = true;
  return Event::Line;
}

} // namespace proto
} // namespace zenit
