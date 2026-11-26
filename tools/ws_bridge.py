#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Serves the simulator's command protocol on a local WebSocket (docs/protocol/protocol-v1.md#websocket).

    python3 tools/ws_bridge.py --sim .pio/build/native/program [--port 8765] [--ws-origin ORIGIN ...]

The bridge starts the simulator with `--protocol --live --transport wifi` and passes lines between it and one
WebSocket client at a time on 127.0.0.1. Every text message of the client is one line for the simulator, and every
protocol line the simulator writes is one text message, without the newline. The simulator's log lines are not
forwarded. The bridge applies the WebSocket rules of the specification: one client at a time (a second connection is
refused with HTTP 503), an origin check (the connection is closed with 1008 after the handshake), and the close codes
1009 (message over the line limit), 1003 (binary message), 1008 (a newline inside a message) and 1007 (invalid UTF-8).

With --app DIR the same port also serves the built web app (web/dist) over plain HTTP, as a board does
(docs/board/wifi-and-updates-v1.md#the-served-web-app): `GET /` and the files of DIR, `GET /board.json`, 404 for anything
else and 405 with `Allow: GET` for another method (HEAD included, as on the board), with the board's security headers.
One difference: the WebSocket library closes the connection of a request that has a body, where a board answers 405. The app, loaded from there, connects to `/ws` on
its own origin. Without it only the WebSocket is served.

The simulator's line `!close-client` (a failed login, a new token) makes the bridge close the open connection with 1008
after the replies that came before it; `!close-client CODE` closes it with CODE (1012 after a web app install, so the
page reloads).

The first line the bridge prints on standard output is `listening ws://127.0.0.1:PORT`. It stops when the simulator
stops, or on Ctrl-C.

Needs Python 3.11 or later (what websockets 17 asks for) and the websockets package, version 17.
"""

import argparse
import asyncio
import http
import json
import re
import signal
import sys
from pathlib import Path

# The longest line the board reads, which a message may not exceed. Mirrors MAX_LINE in
# lib/ZenitProto/src/proto_limits.h.
BOARD_MAX_LINE = 1024
HANDSHAKE_TIMEOUT = 5.0
CLOSE_TIMEOUT = 1.0
MARKER = "@ZN "
# The project's site: GitHub Pages serves the repository at this origin
SITE_ORIGIN = "https://monska85.github.io"
MAX_ORIGIN = 255


# The headers of every answer of the served app: the same as COMMON_HEADERS in lib/ZenitNet/src/net_http.cpp, which
# tools/test_ws_bridge.py compares them with.
SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; connect-src 'self' ws:; img-src 'self' data:; style-src 'self' "
    "'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Connection": "close",
}
MEDIA_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".txt": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
}


class CloseClient:
    """A request of the simulator to close the open connection with `code`."""

    def __init__(self, code):
        self.code = code


def close_request(text):
    """The close code a simulator line asks for: 1008 for `!close-client`, CODE for `!close-client CODE`, else None."""
    if text == "!close-client":
        return 1008
    code = text[14:]
    if text.startswith("!close-client ") and code.isascii() and code.isdigit() and 1000 <= int(code) <= 4999:
        return int(code)
    return None


def _is_port(text):
    return 0 < len(text) <= 5 and text.isascii() and text.isdigit() and int(text) <= 65535


def _private_ipv4(host):
    parts = host.split(".")
    if len(parts) != 4 or not all(re.fullmatch(r"(0|[1-9][0-9]{0,2})", part) and int(part) <= 255 for part in parts):
        return None
    a, b = int(parts[0]), int(parts[1])
    return a in (10, 127) or (a == 172 and 16 <= b <= 31) or (a == 192 and b == 168) or (a == 169 and b == 254)


def _local_name(host):
    return len(host) > 6 and host.endswith(".local") and re.fullmatch(r"[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*", host) is not None


def origin_allowed(origin, extra=()):
    """Whether a connection with this Origin header (None when missing) may use the bridge. It is the rule of the board
    (`origin_allowed` in lib/ZenitNet/src/net_origin.cpp, docs/protocol/protocol-v1.md#websocket), with the origins
    added by --ws-origin: no origin, the project's site, localhost, a `.local` name or a private IPv4 address, over http
    or https, with an optional port. tools/test_ws_bridge.py runs it on the cases of conformance/net/origin.json."""
    if origin is None:
        return True  # command line clients send none
    if len(origin) > MAX_ORIGIN:
        return False
    if origin == SITE_ORIGIN or origin in extra:
        return True
    match = re.fullmatch(r"https?://([^:]*)(?::(.*))?", origin)
    if not match:
        return False
    host, port = match.group(1), match.group(2)
    if port is not None and not _is_port(port):
        return False
    return host == "localhost" or bool(_private_ipv4(host)) or _local_name(host)


class Bridge:
    """One client at a time between the WebSocket and the simulator's standard input and output."""

    def __init__(self, process, extra_origins=(), app_dir=None, hostname="zenit-0000"):
        self.process = process
        self.extra_origins = tuple(extra_origins)
        self.app_dir = Path(app_dir).resolve() if app_dir else None
        self.hostname = hostname
        self.client = None  # the connection holding the slot, from its request until it closes
        self.replies = None  # lines waiting for the open client
        self.tasks = set()
        # One connection at a time talks to the simulator: the next one starts only once the last one's
        # `!wifi-close` is written, so the simulator never sees a close after the next open.
        self.session = asyncio.Lock()
        # The simulator acknowledges `!wifi-close` once it has written every reply to that connection
        self.closed = asyncio.Event()
        self.close_ack_timeout = 2.0

    def page(self, connection, request, allowed=True):
        """The answer to an HTTP request that is not a WebSocket handshake, as the board gives it; None without --app."""
        from websockets.datastructures import Headers
        from websockets.http11 import Response

        def answer(status, media, body, extra=None):
            headers = Headers({**SECURITY_HEADERS, "Content-Type": media, "Content-Length": str(len(body)), **(extra or {})})
            return Response(status.value, status.phrase, headers, body)

        if not allowed:
            return answer(http.HTTPStatus.METHOD_NOT_ALLOWED, "text/plain; charset=utf-8", b"method not allowed\n", {"Allow": "GET"})
        path = request.path.split("?", 1)[0].split("#", 1)[0]
        if path == "/board.json":
            body = json.dumps({"zenit": True, "hostname": self.hostname, "ws": "/ws"}, separators=(",", ":")).encode()
            return answer(http.HTTPStatus.OK, "application/json", body, {"Cache-Control": "no-store"})
        relative = "index.html" if path == "/" else path.lstrip("/")
        if (
            self.app_dir is not None
            and relative
            and not re.search(r"[^\x21-\x7e]|\\|\.\.", relative)
        ):
            file = (self.app_dir / relative).resolve()
            if file.is_file() and self.app_dir in file.parents:
                media = MEDIA_TYPES.get(file.suffix.lower(), "application/octet-stream")
                cache = "public, max-age=31536000, immutable" if relative.startswith("assets/") else "no-cache"
                return answer(http.HTTPStatus.OK, media, file.read_bytes(), {"Cache-Control": cache})
        return answer(http.HTTPStatus.NOT_FOUND, "text/plain; charset=utf-8", b"not found\n")

    def process_request(self, connection, request):
        """Serves the web app to a page request, and refuses a second WebSocket while the first one is open."""
        if self.app_dir is not None and request.headers.get("Upgrade", "").lower() != "websocket":
            if request.method != "GET":
                # As the board: only GET is served (HEAD included), anything else is 405 with Allow: GET
                return self.page(connection, request, allowed=False)
            return self.page(connection, request)
        if self.client is not None:
            return connection.respond(http.HTTPStatus.SERVICE_UNAVAILABLE, "Service Unavailable\n")
        self.client = connection
        task = asyncio.ensure_future(self.free_slot(connection))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return None

    async def free_slot(self, connection):
        await connection.wait_closed()
        if self.client is connection:
            self.client = self.replies = None

    async def send_to_simulator(self, text):
        self.process.stdin.write(text.encode("utf-8") + b"\n")
        await self.process.stdin.drain()

    async def serve(self, connection):
        from websockets.exceptions import ConnectionClosed

        async with self.session:
            if not origin_allowed(connection.request.headers.get("Origin"), self.extra_origins):
                await connection.close(1008)
                return
            replies = self.replies = asyncio.Queue()
            sender = asyncio.ensure_future(self.send_replies(connection, replies))
            try:
                await self.send_to_simulator("!wifi-open")
                async for message in connection:
                    if isinstance(message, bytes):
                        await connection.close(1003)
                    elif "\n" in message:
                        await connection.close(1008)  # one message is one line
                    elif message.startswith("!"):
                        continue  # not a protocol line, and `!` lines are the simulator's own: the board ignores it
                    else:
                        await self.send_to_simulator(message)
            except (ConnectionClosed, BrokenPipeError, ConnectionResetError):
                pass
            finally:
                sender.cancel()
                try:
                    self.closed.clear()
                    await self.send_to_simulator("!wifi-close")
                    # Replies still in the pipe belong to this client: read them (the queue has no sender, so they are
                    # dropped) up to the acknowledgement, before the next client can be served
                    await asyncio.wait_for(self.closed.wait(), self.close_ack_timeout)
                except (BrokenPipeError, ConnectionResetError, asyncio.TimeoutError):
                    pass  # the simulator is gone or slow: go on
                self.replies = None

    async def send_replies(self, connection, replies):
        while True:
            line = await replies.get()
            if isinstance(line, CloseClient):
                await connection.close(line.code)
                return
            await connection.send(line)

    def reply(self, line):
        """Queues a line from the simulator for the open client; dropped when no client is open."""
        if self.replies is not None:
            self.replies.put_nowait(line)

    async def forward_simulator_output(self):
        """Hands each protocol line of the simulator to the client. Returns when the simulator closes its output."""
        while True:
            raw = await self.process.stdout.readline()
            if not raw:
                self.closed.set()  # no acknowledgement will come: nobody waits for one
                return
            text = raw.decode("utf-8", "replace").rstrip("\r\n")
            if text == "!wifi-closed":
                self.closed.set()
            elif (code := close_request(text)) is not None:
                self.reply(CloseClient(code))
            elif text.startswith(MARKER):
                self.reply(text)


async def run(sim, port, extra_origins, out=sys.stdout, app_dir=None, hostname="zenit-0000"):
    """Starts the simulator and serves until it stops. Returns its exit status."""
    from websockets.asyncio.server import serve

    process = await asyncio.create_subprocess_exec(
        sim,
        "--protocol",
        "--live",
        "--transport",
        "wifi",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
    )
    bridge = Bridge(process, extra_origins, app_dir, hostname)
    forwarder = None
    try:
        # No compression and no keepalive pings: plain RFC 6455, as the clients expect.
        async with serve(
            bridge.serve,
            "127.0.0.1",
            port,
            max_size=BOARD_MAX_LINE,
            process_request=bridge.process_request,
            compression=None,
            open_timeout=HANDSHAKE_TIMEOUT,
            close_timeout=CLOSE_TIMEOUT,
            ping_interval=None,
            server_header=None,
        ) as server:
            print(f"listening ws://127.0.0.1:{server.sockets[0].getsockname()[1]}", file=out, flush=True)
            forwarder = asyncio.ensure_future(bridge.forward_simulator_output())
            try:
                await forwarder
            finally:
                # Nothing reads the simulator any more: clients closing now, and the ones waiting, do not wait
                bridge.close_ack_timeout = 0
                bridge.closed.set()
    finally:
        if forwarder is not None:
            forwarder.cancel()
        if process.returncode is None:
            process.stdin.close()  # the simulator ends when its input does
            try:
                await asyncio.wait_for(process.wait(), 2)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
    return process.returncode


def main(argv=None):
    parser = argparse.ArgumentParser(description="Serves the simulator's command protocol on a local WebSocket.")
    parser.add_argument("--sim", required=True, help="the simulator program (pio run -e native builds it)")
    parser.add_argument("--port", type=int, default=8765, help="port on 127.0.0.1 (0 picks a free one)")
    parser.add_argument("--ws-origin", action="append", default=[], metavar="ORIGIN", help="also accept this Origin (repeatable)")
    parser.add_argument("--app", metavar="DIR", help="also serve the built web app of DIR over HTTP, as a board does")
    parser.add_argument("--hostname", default="zenit-0000", help="the hostname /board.json reports (default zenit-0000)")
    args = parser.parse_args(argv)
    if args.app and not (Path(args.app) / "index.html").is_file():
        sys.exit(f"ws_bridge: {args.app}/index.html is missing: build the web app first")
    try:
        import websockets.asyncio.server  # noqa: F401
    except ImportError:
        sys.exit("ws_bridge: needs the websockets package, version 17 (pip install websockets)")
    loop = asyncio.new_event_loop()
    main_task = loop.create_task(run(args.sim, args.port, args.ws_origin, app_dir=args.app, hostname=args.hostname))
    for name in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(name, main_task.cancel)
    try:
        status = loop.run_until_complete(main_task)
    except asyncio.CancelledError:
        status = 0
    except OSError as error:
        sys.exit(f"ws_bridge: {error}")
    finally:
        loop.close()
    sys.exit(status or 0)


if __name__ == "__main__":
    main()
