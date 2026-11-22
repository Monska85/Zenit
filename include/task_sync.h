// SPDX-License-Identifier: GPL-3.0-or-later

// A mutex for the state two tasks share. The board's is a static FreeRTOS mutex; the simulator has one thread, so its
// lock does nothing.

#pragma once

#ifndef ZENIT_SIM
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#endif

class Lock
{
public:
#ifdef ZENIT_SIM
  void take() {}
  void give() {}
#else
  Lock() { handle_ = xSemaphoreCreateMutexStatic(&storage_); }
  void take() { xSemaphoreTake(handle_, portMAX_DELAY); }
  void give() { xSemaphoreGive(handle_); }

private:
  StaticSemaphore_t storage_;
  SemaphoreHandle_t handle_;
#endif
};

class Locked
{
public:
  explicit Locked(Lock &lock) : lock_(lock) { lock_.take(); }
  ~Locked() { lock_.give(); }
  Locked(const Locked &) = delete;
  Locked &operator=(const Locked &) = delete;

private:
  Lock &lock_;
};
