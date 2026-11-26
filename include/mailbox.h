// SPDX-License-Identifier: GPL-3.0-or-later

// A fixed-size queue between two tasks (docs/board/wifi-and-updates-v1.md#tasks-and-memory). On the board it is a
// static FreeRTOS queue, so nothing is allocated after the start; in the simulator, where one thread plays both
// tasks, a plain deque with the same limit.

#pragma once

#include <cstddef>
#include <cstdint>

#ifdef ZENIT_SIM
#include <deque>
#else
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#endif

template <typename T, size_t N> class Mailbox
{
public:
#ifdef ZENIT_SIM
  // False when the box is full, after `wait_ms` on the board.
  bool send(const T &item, uint32_t = 0)
  {
    if (items_.size() >= N)
      return false;
    items_.push_back(item);
    return true;
  }
  bool receive(T &out, uint32_t = 0)
  {
    if (items_.empty())
      return false;
    out = items_.front();
    items_.pop_front();
    return true;
  }
  void clear() { items_.clear(); }

private:
  std::deque<T> items_;
#else
  Mailbox() { queue_ = xQueueCreateStatic(N, sizeof(T), storage_, &control_); }
  bool send(const T &item, uint32_t wait_ms = 0) { return xQueueSend(queue_, &item, pdMS_TO_TICKS(wait_ms)) == pdTRUE; }
  bool receive(T &out, uint32_t wait_ms = 0) { return xQueueReceive(queue_, &out, pdMS_TO_TICKS(wait_ms)) == pdTRUE; }

private:
  StaticQueue_t control_;
  uint8_t storage_[N * sizeof(T)];
  QueueHandle_t queue_;
#endif
};
