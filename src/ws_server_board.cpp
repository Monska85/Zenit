// SPDX-License-Identifier: GPL-3.0-or-later

// The HTTP and WebSocket server of the board: the web app at `/`, the protocol on `/ws`
// (docs/board/wifi-and-updates-v1.md#the-served-web-app). The server task moves bytes; the loop task runs every line.

#ifndef ZENIT_SIM

#include "ws_server.h"

#include <Arduino.h>
#include <esp_http_server.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <lwip/sockets.h>
#include <net_http.h>
#include <net_origin.h>
#include <origin_scan.h>
#include <proto_limits.h>
#include <ws_message.h>

#include <atomic>
#include <cstring>

#include "mailbox.h"
#include "network.h"
#include "platform.h"
#include "protocol.h"
#include "site.h"
#include "updates.h"
#include "www.h"

namespace ws_server
{

namespace
{
using zenit::proto::MessageAssembler;

constexpr uint16_t PORT = 80;
// The client, one that is turned away, and room for a page request meanwhile.
constexpr size_t MAX_SOCKETS = 5;
constexpr uint32_t REPLY_WAIT_MS = 5000;
constexpr uint32_t EVENT_WAIT_MS = 1000;
constexpr size_t SERVER_STACK_BYTES = 5120;
constexpr int KEEP_ALIVE_IDLE_S = 15;
constexpr int KEEP_ALIVE_INTERVAL_S = 5;
constexpr int KEEP_ALIVE_COUNT = 3;
// A WebSocket connection that has not become the client by then is closed, so idle connections cannot fill the sockets.
constexpr uint32_t UNCLAIMED_WAIT_MS = zenit::proto::LOGIN_WAIT_MS;
constexpr uint32_t SWEEP_EVERY_MS = 1000;
const char BUSY_RESPONSE[] = "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";

char site_origin[site::ORIGIN_SIZE];

struct Event
{
  enum class Type : uint8_t
  {
    Open,
    Line,
    Close
  };
  Type type = Type::Open;
  uint16_t size = 0;
  uint32_t id = 0; // of a Line: the reply carries it back
  char text[zenit::proto::MAX_LINE + 1];
};

Mailbox<Event, 3> to_loop;

StaticSemaphore_t reply_semaphore_storage;
SemaphoreHandle_t reply_ready = nullptr;
char reply_text[zenit::proto::MAX_REPLY_LINE + 1];
size_t reply_size = 0;
std::atomic<uint32_t> reply_id{0};

std::atomic<httpd_handle_t> server{nullptr};
std::atomic<int> client_fd{-1};

// Only the server task touches these.
MessageAssembler assembler;
// Every open connection, with the Origin header of its request. This server answers a WebSocket handshake by itself and
// never shows it to a handler, so the header is read from the bytes on their way in.
struct Session
{
  int fd = -1;
  TickType_t opened = 0;
  zenit::net::OriginScan scan;
};
Session sessions[MAX_SOCKETS];
uint8_t payload[zenit::proto::MAX_LINE + 1];
uint32_t next_id = 1;

void send_close_frame(httpd_req_t *req, uint16_t code)
{
  uint8_t status[2] = {static_cast<uint8_t>(code >> 8), static_cast<uint8_t>(code & 0xFF)};
  httpd_ws_frame_t frame = {};
  frame.type = HTTPD_WS_TYPE_CLOSE;
  frame.payload = status;
  frame.len = sizeof(status);
  httpd_ws_send_frame(req, &frame);
}

// Ends the connection after a close frame: an error from the handler makes the server close the socket.
esp_err_t refuse(httpd_req_t *req, uint16_t code)
{
  send_close_frame(req, code);
  return ESP_FAIL;
}

Session *session_of(int fd)
{
  for (Session &session : sessions)
    if (session.fd == fd)
      return &session;
  return nullptr;
}

// The server's receive, which also reads the Origin header of the connection's request.
int recv_scanning(httpd_handle_t, int fd, char *buf, size_t size, int flags)
{
  if (!buf)
    return HTTPD_SOCK_ERR_INVALID;
  const int got = lwip_recv(fd, buf, size, flags);
  if (got < 0)
    return errno == EAGAIN || errno == EWOULDBLOCK ? HTTPD_SOCK_ERR_TIMEOUT : HTTPD_SOCK_ERR_FAIL;
  Session *session = session_of(fd);
  if (got > 0 && !(flags & MSG_PEEK) && session && !session->scan.done())
    session->scan.feed(buf, static_cast<size_t>(got));
  return got;
}

bool origin_ok(int fd)
{
  const Session *session = session_of(fd);
  if (!session || !session->scan.done())
    return false;
  if (session->scan.missing())
    return true;
  const char *origin = session->scan.origin();
  return origin && zenit::net::origin_allowed(origin, site_origin);
}

// Reads the frame that is waiting, then closes with `code`: a socket closed with bytes unread is reset, and the reset
// would drop the close frame on its way out.
esp_err_t read_and_refuse(httpd_req_t *req, uint16_t code)
{
  httpd_ws_frame_t frame = {};
  if (httpd_ws_recv_frame(req, &frame, 0) == ESP_OK && frame.len > 0 && frame.len <= sizeof(payload))
  {
    frame.payload = payload;
    httpd_ws_recv_frame(req, &frame, sizeof(payload));
  }
  return refuse(req, code);
}

// The first message of a WebSocket connection: the connection becomes the client, or is closed.
esp_err_t claim(httpd_req_t *req, int fd)
{
  if (!origin_ok(fd))
    return read_and_refuse(req, zenit::proto::CLOSE_POLICY);
  int expected = -1;
  if (!client_fd.compare_exchange_strong(expected, fd))
    return read_and_refuse(req, zenit::proto::CLOSE_TRY_LATER);
  assembler.reset();
  xSemaphoreTake(reply_ready, 0); // an answer to a line of an earlier connection
  Event open;
  open.type = Event::Type::Open;
  if (!to_loop.send(open, EVENT_WAIT_MS))
    return refuse(req, zenit::proto::CLOSE_INTERNAL_ERROR);
  return ESP_OK;
}

// Hands a line to the loop task and sends back its reply. False when the connection cannot go on.
bool run_line(httpd_req_t *req)
{
  static Event event;
  event.type = Event::Type::Line;
  event.size = static_cast<uint16_t>(assembler.line_size());
  event.id = next_id++;
  std::memcpy(event.text, assembler.line(), event.size);
  event.text[event.size] = '\0';
  if (!to_loop.send(event, EVENT_WAIT_MS))
    return false;
  const TickType_t start = xTaskGetTickCount();
  for (;;)
  {
    const TickType_t elapsed = xTaskGetTickCount() - start;
    if (elapsed >= pdMS_TO_TICKS(REPLY_WAIT_MS) ||
        xSemaphoreTake(reply_ready, pdMS_TO_TICKS(REPLY_WAIT_MS) - elapsed) != pdTRUE)
      return false;
    if (reply_id.load() == event.id)
      break; // another id is a late answer to a line of a connection that is gone
  }
  if (reply_size == 0)
    return true; // not a protocol line: nothing to answer
  httpd_ws_frame_t frame = {};
  frame.type = HTTPD_WS_TYPE_TEXT;
  frame.payload = reinterpret_cast<uint8_t *>(reply_text);
  frame.len = reply_size;
  return httpd_ws_send_frame(req, &frame) == ESP_OK;
}

esp_err_t on_frame(httpd_req_t *req)
{
  httpd_ws_frame_t frame = {};
  if (httpd_ws_recv_frame(req, &frame, 0) != ESP_OK)
    return refuse(req, zenit::proto::CLOSE_PROTOCOL_ERROR); // also a frame the client did not mask
  if (frame.type == HTTPD_WS_TYPE_PONG)
  {
    // An unsolicited pong is allowed: read whole and ignored, without touching a message in progress.
    if (frame.len > 125)
      return refuse(req, zenit::proto::CLOSE_PROTOCOL_ERROR);
    frame.payload = payload;
    if (frame.len > 0 && httpd_ws_recv_frame(req, &frame, sizeof(payload)) != ESP_OK)
      return ESP_FAIL;
    return ESP_OK;
  }
  if (frame.type > HTTPD_WS_TYPE_BINARY)
    return refuse(req, zenit::proto::CLOSE_PROTOCOL_ERROR); // a reserved data opcode

  using Kind = zenit::proto::FrameKind;
  if (assembler.begin_frame(static_cast<Kind>(frame.type), frame.len) == MessageAssembler::Result::Close)
    return refuse(req, assembler.code()); // nothing of a payload that is too long is read
  frame.payload = payload;
  if (frame.len > 0 && httpd_ws_recv_frame(req, &frame, sizeof(payload)) != ESP_OK)
    return ESP_FAIL;
  switch (assembler.end_frame(frame.final, payload, frame.len))
  {
  case MessageAssembler::Result::More:
    return ESP_OK;
  case MessageAssembler::Result::Close:
    return refuse(req, assembler.code());
  case MessageAssembler::Result::Line:
    return run_line(req) ? ESP_OK : refuse(req, zenit::proto::CLOSE_INTERNAL_ERROR);
  }
  return ESP_FAIL;
}

// Called for each frame only: this server answers the handshake by itself.
esp_err_t handle_ws(httpd_req_t *req)
{
  const int fd = httpd_req_to_sockfd(req);
  if (fd != client_fd.load())
  {
    const esp_err_t claimed = claim(req, fd);
    if (claimed != ESP_OK)
      return claimed;
  }
  return on_frame(req);
}

void common_headers(httpd_req_t *req)
{
  for (size_t i = 0; i < zenit::net::COMMON_HEADER_COUNT; i++)
    httpd_resp_set_hdr(req, zenit::net::COMMON_HEADERS[i].name, zenit::net::COMMON_HEADERS[i].value);
}

// Sends the answer and closes the connection once it is out.
esp_err_t finish(httpd_req_t *req, esp_err_t result)
{
  if (httpd_handle_t handle = server.load())
    httpd_sess_trigger_close(handle, httpd_req_to_sockfd(req));
  return result;
}

esp_err_t send_text(httpd_req_t *req, const char *status, const char *body)
{
  httpd_resp_set_status(req, status);
  httpd_resp_set_type(req, "text/plain; charset=utf-8");
  common_headers(req);
  httpd_resp_send(req, body, HTTPD_RESP_USE_STRLEN);
  return finish(req, ESP_OK);
}

// The page served instead of the web app while it is not usable, with 503.
esp_err_t send_emergency(httpd_req_t *req)
{
  static char page[zenit::net::MAX_EMERGENCY_PAGE];
  const size_t size = zenit::net::emergency_page(updates::web_repairable(), site::URL, page, sizeof(page));
  httpd_resp_set_status(req, "503 Service Unavailable");
  httpd_resp_set_type(req, "text/html; charset=utf-8");
  httpd_resp_set_hdr(req, "Cache-Control", "no-store");
  common_headers(req);
  httpd_resp_send(req, page, size);
  return finish(req, ESP_OK);
}

// GET of anything but /ws: a file of the web app, /board.json, the emergency page, or nothing.
esp_err_t handle_get(httpd_req_t *req)
{
  const zenit::net::Asset *assets = nullptr;
  size_t count = 0;
  const bool serving = www::serve_begin(assets, count);
  const zenit::net::Resolved found = zenit::net::resolve(assets, count, req->uri);
  if (found.route != zenit::net::Route::Asset && serving)
    www::serve_end();
  if (found.route == zenit::net::Route::BoardJson)
  {
    char body[96];
    const network::Snapshot net = network::snapshot();
    const size_t size = zenit::net::board_json(net.hostname, body, sizeof(body));
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    common_headers(req);
    httpd_resp_send(req, body, size);
    return finish(req, ESP_OK);
  }
  if (!serving)
    return send_emergency(req);
  if (found.route != zenit::net::Route::Asset)
    return send_text(req, "404 Not Found", "not found\n");
  const zenit::net::Asset &asset = *found.asset;
  httpd_resp_set_type(req, asset.content_type);
  httpd_resp_set_hdr(req, "Content-Encoding", "gzip");
  httpd_resp_set_hdr(req, "Cache-Control", zenit::net::cache_control(asset));
  common_headers(req);
  // The file is read from the mapped partition: an install waits until it is sent.
  const esp_err_t sent = httpd_resp_send(req, reinterpret_cast<const char *>(asset.data), asset.size);
  www::serve_end();
  return finish(req, sent);
}

esp_err_t handle_method_not_allowed(httpd_req_t *req, httpd_err_code_t)
{
  httpd_resp_set_hdr(req, "Allow", "GET");
  return send_text(req, "405 Method Not Allowed", "method not allowed\n");
}

esp_err_t handle_not_found(httpd_req_t *req, httpd_err_code_t)
{
  return send_text(req, "404 Not Found", "not found\n");
}

// A new connection is turned away with 503 while the network task holds the large allocation of a TLS connection.
esp_err_t on_open(httpd_handle_t handle, int fd)
{
  if (network::holds_large_allocation())
  {
    lwip_send(fd, BUSY_RESPONSE, sizeof(BUSY_RESPONSE) - 1, MSG_DONTWAIT);
    return ESP_FAIL;
  }
  Session *session = session_of(-1);
  if (!session)
    return ESP_FAIL; // more connections than the server opens: it does not happen
  // Small answers and close frames go out at once, not held back waiting for an acknowledgement
  const int on = 1;
  lwip_setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &on, sizeof(on));
  session->fd = fd;
  session->opened = xTaskGetTickCount();
  session->scan.reset();
  return httpd_sess_set_recv_override(handle, fd, recv_scanning);
}

// The server task: closes the WebSocket connections that did not become the client in time.
void sweep(void *)
{
  httpd_handle_t handle = server.load();
  if (!handle)
    return;
  const TickType_t now = xTaskGetTickCount();
  for (const Session &session : sessions)
    if (session.fd >= 0 && session.fd != client_fd.load() && now - session.opened >= pdMS_TO_TICKS(UNCLAIMED_WAIT_MS) &&
        httpd_ws_get_fd_info(handle, session.fd) == HTTPD_WS_CLIENT_WEBSOCKET)
      httpd_sess_trigger_close(handle, session.fd);
}

// Runs for every session that ends, whoever ended it; closing the socket is left to this function.
void on_close(httpd_handle_t, int fd)
{
  if (Session *session = session_of(fd))
    session->fd = -1;
  int expected = fd;
  if (client_fd.compare_exchange_strong(expected, -1))
  {
    Event closed;
    closed.type = Event::Type::Close;
    to_loop.send(closed, EVENT_WAIT_MS);
  }
  lwip_close(fd);
}

void after_close_frame(esp_err_t, int fd, void *)
{
  if (httpd_handle_t handle = server.load())
    httpd_sess_trigger_close(handle, fd);
}

// The payloads of the close frames close_client sends: constant, so a frame still queued keeps its code.
uint8_t policy_payload[2] = {zenit::proto::CLOSE_POLICY >> 8, zenit::proto::CLOSE_POLICY & 0xFF};
uint8_t reload_payload[2] = {zenit::proto::CLOSE_RELOAD >> 8, zenit::proto::CLOSE_RELOAD & 0xFF};

// The loop task: the reply of a line goes back to the server task, which is waiting for it.
void keep_reply(const char *line, size_t length)
{
  // A WebSocket message has no newline.
  reply_size = length > 0 && length <= sizeof(reply_text) ? length - 1 : 0;
  std::memcpy(reply_text, line, reply_size);
}
} // namespace

void begin()
{
  reply_ready = xSemaphoreCreateBinaryStatic(&reply_semaphore_storage);
  // The build only takes an https address that fits, so this does not fail; without it no site origin would be allowed
  if (!zenit::net::site_origin_of(site::URL, site_origin, sizeof(site_origin)))
    platform::log("the site address has no origin the WebSocket can allow");
}

bool start()
{
  if (server.load())
    return true;
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = PORT;
  config.stack_size = SERVER_STACK_BYTES;
  config.task_priority = 2;
  config.max_open_sockets = MAX_SOCKETS;
  config.max_uri_handlers = 3;
  config.uri_match_fn = httpd_uri_match_wildcard;
  config.lru_purge_enable = false; // a flood of connections never evicts the client
  config.recv_wait_timeout = 5;    // a request that stays incomplete is dropped after this many seconds
  config.send_wait_timeout = 5;
  config.keep_alive_enable = true;
  config.keep_alive_idle = KEEP_ALIVE_IDLE_S;
  config.keep_alive_interval = KEEP_ALIVE_INTERVAL_S;
  config.keep_alive_count = KEEP_ALIVE_COUNT;
  config.open_fn = on_open;
  config.close_fn = on_close;
  httpd_handle_t started = nullptr;
  if (httpd_start(&started, &config) != ESP_OK)
  {
    platform::log("the HTTP server did not start");
    return false;
  }
  server = started;
  httpd_uri_t ws = {};
  ws.uri = "/ws";
  ws.method = HTTP_GET;
  ws.handler = handle_ws;
  ws.is_websocket = true;
  httpd_uri_t page = {};
  page.uri = "/*";
  page.method = HTTP_GET;
  page.handler = handle_get;
  if (httpd_register_uri_handler(started, &ws) != ESP_OK || httpd_register_uri_handler(started, &page) != ESP_OK ||
      httpd_register_err_handler(started, HTTPD_405_METHOD_NOT_ALLOWED, handle_method_not_allowed) != ESP_OK ||
      httpd_register_err_handler(started, HTTPD_404_NOT_FOUND, handle_not_found) != ESP_OK)
  {
    server = nullptr;
    httpd_stop(started);
    platform::log("the HTTP server could not register its handlers");
    return false;
  }
  return true;
}

bool running() { return server.load() != nullptr; }

void stop()
{
  httpd_handle_t stopping = server.exchange(nullptr);
  if (stopping)
    httpd_stop(stopping); // ends every session, and on_close tells the loop task
}

void poll(uint64_t now)
{
  static uint64_t last_sweep = 0;
  if (now - last_sweep >= SWEEP_EVERY_MS)
  {
    last_sweep = now;
    if (httpd_handle_t handle = server.load())
      httpd_queue_work(handle, sweep, nullptr);
  }
  static Event event;
  for (int handled = 0; handled < 4 && to_loop.receive(event, 0); handled++)
  {
    switch (event.type)
    {
    case Event::Type::Open:
      protocol::wifi_opened(now);
      break;
    case Event::Type::Close:
      protocol::wifi_closed();
      break;
    case Event::Type::Line:
      reply_size = 0;
      protocol::handle_line(protocol::Transport::Wifi, event.text, event.size, now, keep_reply);
      reply_id = event.id;
      xSemaphoreGive(reply_ready);
      if (protocol::take_wifi_close_request())
        close_client();
      break;
    }
  }
  // Also a request made without a line: a client that stayed unauthenticated too long (protocol::poll)
  if (protocol::take_wifi_close_request())
    close_client();
}

void close_client(uint16_t code)
{
  const int fd = client_fd.load();
  httpd_handle_t handle = server.load();
  if (fd < 0 || !handle)
    return;

  httpd_ws_frame_t frame = {};
  frame.type = HTTPD_WS_TYPE_CLOSE;
  frame.payload = code == zenit::proto::CLOSE_RELOAD ? reload_payload : policy_payload;
  frame.len = 2;
  // The close frame goes out in the server task, after the handler that may be waiting for its reply.
  if (httpd_ws_send_data_async(handle, fd, &frame, after_close_frame, nullptr) != ESP_OK)
    httpd_sess_trigger_close(handle, fd);
}

} // namespace ws_server

#endif
