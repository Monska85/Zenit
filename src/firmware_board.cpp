// SPDX-License-Identifier: GPL-3.0-or-later

#ifndef ZENIT_SIM

#include "firmware.h"

#include <Arduino.h>
#include <esp_ota_ops.h>
#include <esp_system.h>

#include "output.h"
#include "platform.h"

// The Arduino core confirms the running image right after its own start unless this says otherwise: the loop task
// confirms it after the health check instead (docs/board/wifi-and-updates-v1.md#rollback).
extern "C" bool verifyRollbackLater() { return true; }

namespace firmware
{

namespace
{
const esp_partition_t *target = nullptr;
esp_ota_handle_t handle = 0;
bool open = false;
} // namespace

bool on_trial()
{
  esp_ota_img_states_t state;
  const esp_partition_t *running = esp_ota_get_running_partition();
  return running && esp_ota_get_state_partition(running, &state) == ESP_OK && state == ESP_OTA_IMG_PENDING_VERIFY;
}

bool other_slot_invalid() { return esp_ota_get_last_invalid_partition() != nullptr; }

bool mark_valid() { return esp_ota_mark_app_valid_cancel_rollback() == ESP_OK; }

void mark_invalid_and_restart()
{
  output::write(zenit::Duties{});
  esp_ota_mark_app_invalid_rollback_and_reboot();
}

bool begin_install(uint32_t size)
{
  if (open)
    abort_install();
  target = esp_ota_get_next_update_partition(nullptr);
  if (!target || size > target->size)
    return false;
  open = esp_ota_begin(target, size, &handle) == ESP_OK;
  return open;
}

bool write(const uint8_t *data, size_t size) { return open && esp_ota_write(handle, data, size) == ESP_OK; }

bool end_install()
{
  if (!open)
    return false;
  open = false;
  return esp_ota_end(handle) == ESP_OK;
}

void abort_install()
{
  if (open)
    esp_ota_abort(handle);
  open = false;
}

bool activate() { return target && esp_ota_set_boot_partition(target) == ESP_OK; }

void restart()
{
  // The pins fall back to their pull-downs while the chip restarts: start from every duty at 0.
  output::write(zenit::Duties{});
  delay(50);
  esp_restart();
}

} // namespace firmware

#endif
