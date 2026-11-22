# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests of tools/ws_bridge.py: python3 -m unittest discover -s tools

The WebSocket rules are tested against the real simulator, so they need its program (pio run -e native).
"""

from socket import create_connection
import asyncio
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ws_bridge  # noqa: E402
import zenit  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SIMULATOR = ROOT / ".pio" / "build" / "native" / "program"
BRIDGE = Path(__file__).resolve().parent / "ws_bridge.py"

try:
    from websockets.exceptions import ConnectionClosed, InvalidStatus
    from websockets.sync.client import connect

    HAVE_WEBSOCKETS = True
except ImportError:
    HAVE_WEBSOCKETS = False


class FakeStream:
    def __init__(self):
        self.lines = []

    def write(self, data):
        self.lines.append(data.decode().strip())

    async def drain(self):
        await asyncio.sleep(0)


class FakeProcess:
    def __init__(self):
        self.stdin = FakeStream()


@unittest.skipUnless(HAVE_WEBSOCKETS, "needs the websockets package")
class ControlLineOrderTest(unittest.IsolatedAsyncioTestCase):
    async def test_a_close_is_written_before_the_next_open(self):
        from websockets.asyncio.client import connect as aconnect
        from websockets.asyncio.server import serve

        process = FakeProcess()
        bridge = ws_bridge.Bridge(process)
        bridge.close_ack_timeout = 0  # the fake simulator acknowledges nothing
        async with serve(bridge.serve, "127.0.0.1", 0, process_request=bridge.process_request, compression=None) as server:
            url = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}"
            for _ in range(30):
                while True:
                    try:
                        client = await aconnect(url, compression=None)
                        break
                    except InvalidStatus:
                        await asyncio.sleep(0.005)
                await client.close()
            # Wait for the last close to be written
            for _ in range(200):
                if process.stdin.lines.count("!wifi-close") == 30:
                    break
                await asyncio.sleep(0.01)
        self.assertEqual(process.stdin.lines, ["!wifi-open", "!wifi-close"] * 30)


class OriginTest(unittest.TestCase):
    def test_allowed_origins(self):
        for origin in (
            None,
            "http://localhost",
            "http://localhost:5173",
            "http://127.0.0.1",
            "http://127.0.0.1:4173",
            "http://localhost:1",
            "http://localhost:65535",
            "http://localhost:8080",
            "https://monska85.github.io",
        ):
            self.assertTrue(ws_bridge.origin_allowed(origin), origin)

    def test_refused_origins(self):
        for origin in (
            "https://example.com",
            "http://localhost.example.com",
            "http://localhost:99999x",
            "http://localhost:0",
            "http://localhost:65536",
            "http://localhost:99999",
            "http://localhost:080",
            "http://localhost:",
            "http://127.0.0.1:123456",
            "https://localhost",
            "http://127.0.0.1.example.com",
            "https://monska85.github.io.evil.example",
            "http://monska85.github.io",
            "null",
            "",
        ):
            self.assertFalse(ws_bridge.origin_allowed(origin), origin)

    def test_added_origins_are_exact(self):
        extra = ["https://app.example.org"]
        self.assertTrue(ws_bridge.origin_allowed("https://app.example.org", extra))
        self.assertFalse(ws_bridge.origin_allowed("https://app.example.org:8443", extra))
        self.assertFalse(ws_bridge.origin_allowed("https://example.org", extra))


@unittest.skipUnless(SIMULATOR.exists() and HAVE_WEBSOCKETS, "needs the simulator program and the websockets package")
class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.process = subprocess.Popen(
            [sys.executable, str(BRIDGE), "--sim", str(SIMULATOR), "--port", "0", "--ws-origin", "https://app.example.org"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.addCleanup(self.stop)
        first = self.process.stdout.readline().strip()
        self.assertRegex(first, r"^listening ws://127\.0\.0\.1:[0-9]+$")
        self.url = first.split(" ", 1)[1]

    def stop(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        self.process.stdout.close()
        self.process.stderr.close()

    def open(self, **kwargs):
        socket = connect(self.url, compression=None, **kwargs)
        self.addCleanup(socket.close)
        return socket

    def ask(self, socket, request):
        socket.send(zenit.frame(request).decode("utf-8"))
        # The simulator may also write log lines, which the bridge does not forward
        reply = zenit.parse_line(socket.recv(timeout=5).encode("utf-8"))
        self.assertIsNotNone(reply)
        return reply

    def closed_with(self, socket):
        with self.assertRaises(ConnectionClosed):
            socket.recv(timeout=5)
        return socket.protocol.close_code

    def test_requests_get_replies(self):
        socket = self.open()
        info = self.ask(socket, {"seq": 1, "cmd": "info"})
        self.assertEqual((info["ok"], info["board"], info["limits"]["line"]), (True, "simulator", 1024))
        reply = self.ask(socket, {"seq": 2, "cmd": "settings_set", "brightness": 40})
        self.assertEqual(reply["settings"]["brightness"], 40)

    def test_the_connection_is_the_wifi_transport(self):
        socket = self.open()
        self.assertEqual(self.ask(socket, {"seq": 1, "cmd": "settings_reset"})["error"], "usb_only")

    def test_a_line_that_is_not_a_protocol_line_gets_no_reply(self):
        socket = self.open()
        socket.send("hello")
        self.assertEqual(self.ask(socket, {"seq": 1, "cmd": "info"})["seq"], 1)

    def test_a_damaged_line_gets_bad_frame_and_the_connection_stays(self):
        socket = self.open()
        socket.send('@ZN 00000000 {"seq":1,"cmd":"info"}')
        reply = zenit.parse_line(socket.recv(timeout=5).encode("utf-8"))
        self.assertEqual(reply["error"], "bad_frame")
        self.assertEqual(self.ask(socket, {"seq": 2, "cmd": "info"})["seq"], 2)

    def test_a_second_client_is_refused_until_the_first_closes(self):
        first = self.open()
        self.ask(first, {"seq": 1, "cmd": "info"})
        with self.assertRaises(InvalidStatus) as refused:
            connect(self.url, compression=None)
        self.assertEqual(refused.exception.response.status_code, 503)
        first.close()
        for _ in range(50):
            try:
                second = self.open()
                break
            except InvalidStatus:
                import time

                time.sleep(0.1)
        else:
            self.fail("the slot was not freed")
        self.assertEqual(self.ask(second, {"seq": 1, "cmd": "info"})["ok"], True)

    def test_origin_check(self):
        for origin in (
            "https://monska85.github.io",
            "http://localhost:5173",
            "http://127.0.0.1",
            "https://app.example.org",
        ):
            socket = self.open(origin=origin)
            self.assertTrue(self.ask(socket, {"seq": 1, "cmd": "info"})["ok"], origin)
            socket.close()
            self.wait_for_slot()
        socket = self.open(origin="https://example.com")
        self.assertEqual(self.closed_with(socket), 1008)

    def wait_for_slot(self):
        import time

        for _ in range(50):
            try:
                connect(self.url, compression=None).close()
                return
            except InvalidStatus:
                time.sleep(0.1)
        self.fail("the slot was not freed")

    def test_a_message_ending_in_a_carriage_return_is_bad_frame(self):
        # A WebSocket message has no line ending: a carriage return at its end is part of the JSON, as on the board
        socket = self.open()
        socket.send(zenit.frame({"seq": 1, "cmd": "info"}).decode() + "\r")
        reply = zenit.parse_line(socket.recv(timeout=5).encode("utf-8"))
        self.assertEqual(reply["error"], "bad_frame")
        self.assertEqual(self.ask(socket, {"seq": 2, "cmd": "info"})["seq"], 2)

    def test_a_reply_to_a_client_that_left_never_reaches_the_next_one(self):
        for round_ in range(15):
            first = self.open()
            for seq in range(100, 110):
                first.send(zenit.frame({"seq": seq, "cmd": "info"}).decode())
            first.close()
            self.wait_for_slot()
            second = self.open()
            reply = self.ask(second, {"seq": 5000 + round_, "cmd": "info"})
            self.assertEqual(reply["seq"], 5000 + round_)
            second.close()
            self.wait_for_slot()

    def test_a_message_over_the_line_limit_closes_with_1009(self):
        socket = self.open()
        socket.send("@ZN 00000000 " + "x" * 1012)
        self.assertEqual(self.closed_with(socket), 1009)

    def test_a_message_of_exactly_the_limit_is_read(self):
        socket = self.open()
        socket.send("zenit: " + "x" * (1024 - 7))
        self.assertEqual(self.ask(socket, {"seq": 1, "cmd": "info"})["seq"], 1)

    def test_lines_that_start_with_a_bang_never_reach_the_simulator_as_control_lines(self):
        socket = self.open()
        for line in ("!advance 100000", "!wifi-close", "!wifi-open", "!anything"):
            socket.send(line)
        # Nothing came back: the first reply is the answer to the request after them
        self.assertEqual(self.ask(socket, {"seq": 2, "cmd": "info"})["seq"], 2)

    def test_a_binary_message_closes_with_1003(self):
        socket = self.open()
        socket.send(b"@ZN 00000000 {}")
        self.assertEqual(self.closed_with(socket), 1003)

    def test_a_newline_inside_a_message_closes_with_1008(self):
        socket = self.open()
        socket.send(zenit.frame({"seq": 1, "cmd": "info"}).decode() + "\n")
        self.assertEqual(self.closed_with(socket), 1008)

    def test_invalid_utf8_closes_with_1007(self):
        # A text frame with bytes that are not UTF-8, which the client library would not send: a raw socket.
        host, port = self.url[len("ws://") :].split(":")
        with create_connection((host, int(port)), timeout=5) as raw:
            raw.sendall(
                (
                    f"GET / HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
                ).encode()
            )
            head = b""
            while b"\r\n\r\n" not in head:
                head += raw.recv(1024)
            self.assertTrue(head.startswith(b"HTTP/1.1 101"))
            mask = b"\x01\x02\x03\x04"
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(b"\xff\xfe"))
            raw.sendall(bytes([0x81, 0x80 | len(payload)]) + mask + payload)
            frame = b""
            while len(frame) < 4:
                chunk = raw.recv(1024)
                self.assertTrue(chunk, "the connection closed without a close frame")
                frame += chunk
            self.assertEqual(frame[0] & 0x0F, 8)  # a close frame
            self.assertEqual(int.from_bytes(frame[2:4], "big"), 1007)

    def test_the_bridge_stops_with_the_simulator(self):
        self.process.terminate()
        self.assertIn(self.process.wait(timeout=5), (0, -15))


if __name__ == "__main__":
    unittest.main()
