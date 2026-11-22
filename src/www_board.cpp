// SPDX-License-Identifier: GPL-3.0-or-later

// The `www` partition on the board: memory-mapped for the HTTP server, written through esp_partition by an install.

#ifndef ZENIT_SIM

#include "www.h"

#include <esp_partition.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <proto_limits.h>
#include <web_image.h>

#include <atomic>
#include <cstring>

#include "platform.h"
#include "task_sync.h"

namespace www
{

namespace
{
using zenit::update::WebState;

constexpr esp_partition_subtype_t WWW_SUBTYPE = static_cast<esp_partition_subtype_t>(0x40);
// The longest an install waits for the files being sent before it gives up: longer than the HTTP server's send timeout
// (5 s, ws_server_board.cpp), so a slow client is dropped by the server first.
constexpr uint32_t SERVE_DRAIN_MS = 6000;

const esp_partition_t *partition = nullptr;
const void *mapped = nullptr;
esp_partition_mmap_handle_t map_handle = 0;
bool mapped_ok = false;

zenit::net::Asset assets_[zenit::net::MAX_WEB_FILES];
size_t count_ = 0;
char version_[zenit::net::WEB_VERSION_FIELD + 1] = {0};

std::atomic<WebState> state_{WebState::Missing};
// Guards version_ and keeps it consistent with state_ for info(): the network task rewrites both during an install.
Lock info_lock;
std::atomic<int> serving{0};

class PartitionFlash : public zenit::net::WebFlash
{
public:
  bool erase(uint32_t offset, uint32_t size) override
  {
    return esp_partition_erase_range(partition, offset, size) == ESP_OK;
  }
  bool write(uint32_t offset, const uint8_t *data, size_t size) override
  {
    return esp_partition_write(partition, offset, data, size) == ESP_OK;
  }
};

PartitionFlash flash;
zenit::net::WebWriter writer;

void unmap()
{
  if (mapped_ok)
    esp_partition_munmap(map_handle);
  mapped_ok = false;
  mapped = nullptr;
  count_ = 0;
  Locked held(info_lock);
  version_[0] = '\0';
}

// Maps the partition and reads its image; sets the state.
void load()
{
  unmap();
  if (!partition)
  {
    state_ = WebState::Missing;
    return;
  }
  if (esp_partition_mmap(partition, 0, partition->size, ESP_PARTITION_MMAP_DATA, &mapped, &map_handle) != ESP_OK)
  {
    platform::log("the www partition could not be mapped");
    state_ = WebState::Missing;
    return;
  }
  mapped_ok = true;
  zenit::net::WebImageInfo info;
  const char *why = "";
  const bool valid =
      zenit::net::read_web_image(static_cast<const uint8_t *>(mapped), partition->size, info, assets_, count_, why);
  if (!valid)
  {
    count_ = 0;
    platform::log("no web app: %s", why);
  }
  {
    Locked held(info_lock);
    std::strcpy(version_, valid ? info.version : "");
    state_ =
        zenit::update::judge_web_image(valid, info.protocol_min, info.protocol_max, zenit::proto::PROTOCOL_VERSION);
  }
  if (state_ == WebState::Incompatible)
    platform::log("web app %s does not speak protocol %u", version_, zenit::proto::PROTOCOL_VERSION);
}
} // namespace

void begin()
{
  partition = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, WWW_SUBTYPE, "www");
  if (!partition)
    platform::log("no www partition");
  load();
}

WebState state() { return state_.load(); }

Info info()
{
  Locked held(info_lock);
  Info out;
  out.state = state_.load();
  // A version belongs to an image that reads: none while installing or missing.
  const bool has_image = out.state == WebState::Ok || out.state == WebState::Incompatible;
  std::strcpy(out.version, has_image ? version_ : "");
  return out;
}

bool serve_begin(const zenit::net::Asset *&assets, size_t &count)
{
  serving.fetch_add(1);
  if (state_.load() != WebState::Ok)
  {
    serving.fetch_sub(1);
    return false;
  }
  assets = assets_;
  count = count_;
  return true;
}

void serve_end() { serving.fetch_sub(1); }

bool begin_install(uint32_t size, const char *version)
{
  if (!partition || size > partition->size)
    return false;
  const WebState before = state_.load();
  state_ = WebState::Installing;
  // A file being sent reads the mapped partition: wait for it before the flash changes under it. On a timeout nothing
  // was touched: the mapping stays, as the file still being sent reads it, and the state goes back.
  for (uint32_t waited = 0; serving.load() > 0; waited += 10)
  {
    if (waited >= SERVE_DRAIN_MS)
    {
      state_ = before;
      return false;
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
  unmap();
  if (!writer.begin(flash, size, version, zenit::proto::PROTOCOL_VERSION))
  {
    load();
    return false;
  }
  return true;
}

bool write(const uint8_t *data, size_t size) { return writer.write(data, size); }
bool install_refused() { return writer.refused(); }

bool end_install()
{
  const bool written = writer.finish();
  load();
  return written && state_.load() != WebState::Missing;
}

void abort_install() { load(); }

} // namespace www

#endif
