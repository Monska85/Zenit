// SPDX-License-Identifier: GPL-3.0-or-later

// HTTPS reads for the update flow, on the network task: esp_http_client with the certificate bundle.

#ifndef ZENIT_SIM

#include "update_http.h"

#include <esp_crt_bundle.h>
#include <esp_http_client.h>
#include <esp_timer.h>
#include <esp_tls.h>
#include <sha256.h>

#include <cstring>

#include "install_target.h"
#include "platform.h"

namespace update_http
{

namespace
{
constexpr int READ_TIMEOUT_MS = 10000;
constexpr uint32_t MANIFEST_TOTAL_MS = 30000;
constexpr uint32_t DOWNLOAD_TOTAL_MS = 10 * 60 * 1000;
constexpr size_t CHUNK = 2048;

uint8_t chunk[CHUNK];

bool allowed_scheme(const char *url)
{
  if (std::strncmp(url, "https://", 8) == 0)
    return true;
#ifdef ZENIT_ALLOW_HTTP_UPDATES
  return std::strncmp(url, "http://", 7) == 0;
#else
  return false;
#endif
}

// Opens `url`: the status and the length of the answer. On failure the outcome says why.
Outcome open_url(const char *url, esp_http_client_handle_t &client, int64_t &length)
{
  client = nullptr;
  if (!allowed_scheme(url))
    return Outcome::Unreachable;
  esp_http_client_config_t config = {};
  config.url = url;
  config.timeout_ms = READ_TIMEOUT_MS;
  config.crt_bundle_attach = esp_crt_bundle_attach;
  config.disable_auto_redirect = true;
  config.buffer_size = 1024;
  config.buffer_size_tx = 512;
  config.keep_alive_enable = false;
  client = esp_http_client_init(&config);
  if (!client)
    return Outcome::Unreachable;
  if (esp_http_client_open(client, 0) != ESP_OK)
  {
    // The call returns the last error of the TLS layer, which is not ESP_OK after a real failure: only the two codes
    // it fills in say whether the certificate or the handshake was refused.
    int tls_code = 0, tls_flags = 0;
    (void)esp_http_client_get_and_clear_last_tls_error(client, &tls_code, &tls_flags);
    const bool refused = tls_code != 0 || tls_flags != 0;
    esp_http_client_cleanup(client);
    client = nullptr;
    return refused ? Outcome::TlsError : Outcome::Unreachable;
  }
  // The length of the body: 0 for a chunked answer or none given, negative on an error.
  length = esp_http_client_fetch_headers(client);
  if (length < 0)
  {
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    client = nullptr;
    return Outcome::Unreachable;
  }
  const int status = esp_http_client_get_status_code(client);
  if (status == 404 || status == 403)
    return Outcome::NotPublished;
  if (status != 200)
    return Outcome::Unreachable;
  return Outcome::Ok;
}

void close_url(esp_http_client_handle_t client)
{
  if (!client)
    return;
  esp_http_client_close(client);
  esp_http_client_cleanup(client);
}

uint32_t now_ms() { return static_cast<uint32_t>(esp_timer_get_time() / 1000); }
} // namespace

Outcome fetch_manifest(const char *url, char *body, size_t capacity, size_t &size)
{
  esp_http_client_handle_t client;
  int64_t length = 0;
  Outcome outcome = open_url(url, client, length);
  if (outcome != Outcome::Ok)
  {
    close_url(client);
    return outcome;
  }
  const uint32_t started = now_ms();
  size = 0;
  for (;;)
  {
    if (now_ms() - started > MANIFEST_TOTAL_MS)
    {
      outcome = Outcome::Unreachable;
      break;
    }
    const int read = esp_http_client_read(client, body + size, static_cast<int>(capacity - size));
    if (read < 0)
    {
      outcome = Outcome::Unreachable;
      break;
    }
    if (read == 0)
    {
      if (esp_http_client_is_complete_data_received(client))
        break;
      outcome = Outcome::Unreachable;
      break;
    }
    size += static_cast<size_t>(read);
    if (size >= capacity)
    {
      // One more byte shows whether the answer is longer than the limit.
      uint8_t extra;
      outcome =
          esp_http_client_read(client, reinterpret_cast<char *>(&extra), 1) > 0 ? Outcome::BadDownload : Outcome::Ok;
      break;
    }
  }
  close_url(client);
  return outcome;
}

Outcome download(install_target::Target target, const char *url, const zenit::update::Manifest &manifest,
                 Progress progress, Stop stop)
{
  const uint32_t size = manifest.size;
  const char *sha256 = manifest.sha256;
  esp_http_client_handle_t client;
  int64_t length = 0;
  Outcome outcome = open_url(url, client, length);
  if (outcome != Outcome::Ok)
  {
    close_url(client);
    return outcome;
  }
  // A length that is given must be the manifest's; 0 is a chunked answer, checked by the bytes that arrive.
  if (length > 0 && length != static_cast<int64_t>(size))
  {
    close_url(client);
    return Outcome::BadDownload;
  }
  if (!install_target::begin(target, manifest))
  {
    close_url(client);
    // A page still being sent that the install could not wait for is a busy board, tried again later like a network
    // that did not answer, not a failing flash.
    return target == install_target::Target::Web && www::install_busy() ? Outcome::Unreachable : Outcome::FlashError;
  }
  zenit::net::Sha256 hash;
  uint32_t received = 0;
  int last_percent = -1;
  const uint32_t started = now_ms();
  outcome = Outcome::Ok;
  while (received < size)
  {
    if (now_ms() - started > DOWNLOAD_TOTAL_MS || (stop && stop()))
    {
      outcome = Outcome::Unreachable;
      break;
    }
    const size_t want = size - received < CHUNK ? size - received : CHUNK;
    const int read = esp_http_client_read(client, reinterpret_cast<char *>(chunk), static_cast<int>(want));
    if (read < 0)
    {
      outcome = Outcome::Unreachable;
      break;
    }
    if (read == 0)
    {
      // The server ended before the size the manifest promised.
      outcome = Outcome::BadDownload;
      break;
    }
    if (!install_target::write(target, chunk, static_cast<size_t>(read)))
    {
      // An image whose header is not the one offered is a bad download: nothing was erased.
      outcome =
          target == install_target::Target::Web && www::install_refused() ? Outcome::BadDownload : Outcome::FlashError;
      break;
    }
    hash.update(chunk, static_cast<size_t>(read));
    received += static_cast<uint32_t>(read);
    const int percent = static_cast<int>(static_cast<uint64_t>(received) * 100 / size);
    if (progress && percent != last_percent)
    {
      progress(static_cast<uint8_t>(percent));
      last_percent = percent;
    }
  }
  if (outcome == Outcome::Ok)
  {
    // The file must end where the manifest says.
    uint8_t extra;
    if (esp_http_client_read(client, reinterpret_cast<char *>(&extra), 1) > 0)
      outcome = Outcome::BadDownload;
  }
  close_url(client);
  if (outcome != Outcome::Ok)
  {
    install_target::abort(target);
    return outcome;
  }
  uint8_t digest[zenit::net::SHA256_SIZE];
  char hex[zenit::net::SHA256_HEX + 1];
  const bool hashed = hash.finish(digest);
  if (hashed)
    zenit::net::to_hex(digest, hex);
  if (!hashed || std::strcmp(hex, sha256) != 0)
  {
    install_target::abort(target);
    return Outcome::BadDownload;
  }
  return install_target::end(target) ? Outcome::Ok : Outcome::FlashError;
}

} // namespace update_http

#endif
