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

The first line the bridge prints on standard output is `listening ws://127.0.0.1:PORT`. It stops when the simulator
stops, or on Ctrl-C.

Needs Python 3.11 or later (what websockets 17 asks for) and the websockets package, version 17.
"""

import argparse
import asyncio
import http
import re
import signal
import sys

# The longest line the board reads, which a message may not exceed. Mirrors MAX_LINE in
# lib/ZenitProto/src/proto_limits.h.
BOARD_MAX_LINE = 1024
HANDSHAKE_TIMEOUT = 5.0
CLOSE_TIMEOUT = 1.0
MARKER = "@ZN "
# A port is 1 to 65535, without leading zeros
PORT = r"(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])"
LOCAL_ORIGIN = re.compile(rf"http://(localhost|127\.0\.0\.1)(:{PORT})?")
# The project's site: GitHub Pages serves the repository at this origin
SITE_ORIGIN = "https://monska85.github.io"


def origin_allowed(origin, extra=()):
    """Whether a connection with this Origin header (None when missing) may use the bridge."""
    if origin is None:
        return True  # command line clients send none
    return bool(LOCAL_ORIGIN.fullmatch(origin)) or origin == SITE_ORIGIN or origin in extra


class Bridge:
    """One client at a time between the WebSocket and the simulator's standard input and output."""

    def __init__(self, process, extra_origins=()):
        self.process = process
        self.extra_origins = tuple(extra_origins)
        self.client = None  # the connection holding the slot, from its request until it closes
        self.replies = None  # lines waiting for the open client
        self.tasks = set()
        # One connection at a time talks to the simulator: the next one starts only once the last one's
        # `!wifi-close` is written, so the simulator never sees a close after the next open.
        self.session = asyncio.Lock()
        # The simulator acknowledges `!wifi-close` once it has written every reply to that connection
        self.closed = asyncio.Event()
        self.close_ack_timeout = 2.0

    def process_request(self, connection, request):
        """Refuses a second connection while the first one is open."""
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
            await connection.send(await replies.get())

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
            elif text.startswith(MARKER):
                self.reply(text)


async def run(sim, port, extra_origins, out=sys.stdout):
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
    bridge = Bridge(process, extra_origins)
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
    args = parser.parse_args(argv)
    try:
        import websockets.asyncio.server  # noqa: F401
    except ImportError:
        sys.exit("ws_bridge: needs the websockets package, version 17 (pip install websockets)")
    loop = asyncio.new_event_loop()
    main_task = loop.create_task(run(args.sim, args.port, args.ws_origin))
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
