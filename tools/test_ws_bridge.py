# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests of tools/ws_bridge.py: python3 -m unittest discover -s tools

The WebSocket rules are tested against the real simulator, so they need its program (pio run -e native).
"""

from socket import create_connection
import asyncio
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ws_bridge  # noqa: E402
import zenit  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SIMULATOR = ROOT / ".pio" / "build" / "native" / "program"
BRIDGE = Path(__file__).resolve().parent / "ws_bridge.py"
# CI has every dependency and builds the simulator first: a missing one there is a failure, not a skip
IN_CI = bool(os.environ.get("CI"))

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


@unittest.skipUnless(HAVE_WEBSOCKETS or IN_CI, "needs the websockets package")
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
    def test_the_conformance_cases_of_the_boards_origin_check(self):
        cases = json.loads((ROOT / "conformance" / "net" / "origin.json").read_text(encoding="utf-8"))
        self.assertEqual(cases["site_origin"], ws_bridge.SITE_ORIGIN)
        for case in cases["cases"]:
            self.assertEqual(ws_bridge.origin_allowed(case["origin"]), case["allowed"], str(case["origin"]))

    def test_the_origins_of_the_development_server_and_the_end_to_end_tests(self):
        for origin in ("http://localhost:5173", "http://127.0.0.1:4173", "http://localhost:65535", "https://monska85.github.io"):
            self.assertTrue(ws_bridge.origin_allowed(origin), origin)

    def test_private_and_local_origins_are_allowed_as_on_the_board(self):
        for origin in ("http://192.168.1.20", "https://192.168.1.20:8443", "http://10.0.0.1", "http://zenit-a1b2.local",
                       "http://zenit-a1b2.local:80", "http://169.254.1.1"):
            self.assertTrue(ws_bridge.origin_allowed(origin), origin)

    def test_public_origins_are_refused(self):
        for origin in ("http://8.8.8.8", "http://example.com", "https://example.com", "http://172.32.0.1", "http://evil.local.com",
                       "http://localhost.example.com", "null", "", "http://localhost:99999", "https://monska85.github.io.evil.example"):
            self.assertFalse(ws_bridge.origin_allowed(origin), origin)

    def test_added_origins_are_exact(self):
        extra = ["https://app.example.org"]
        self.assertTrue(ws_bridge.origin_allowed("https://app.example.org", extra))
        self.assertFalse(ws_bridge.origin_allowed("https://app.example.org:8443", extra))
        self.assertFalse(ws_bridge.origin_allowed("https://example.org", extra))


@unittest.skipUnless((SIMULATOR.exists() and HAVE_WEBSOCKETS) or IN_CI, "needs the simulator program and the websockets package")
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
        return self.enterContext(connect(self.url, compression=None, **kwargs))

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
                with connect(self.url, compression=None):
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


@unittest.skipUnless((SIMULATOR.exists() and HAVE_WEBSOCKETS) or IN_CI, "needs the simulator program and the websockets package")
class ServedAppTest(unittest.TestCase):
    """The bridge with --app answers page requests as a board does."""

    def setUp(self):
        self.dist = tempfile.TemporaryDirectory()
        self.addCleanup(self.dist.cleanup)
        root = Path(self.dist.name)
        (root / "assets").mkdir()
        (root / "index.html").write_text("<!doctype html><title>Zenit</title>", encoding="utf-8")
        (root / "assets" / "app-abc.js").write_text("console.log(1)", encoding="utf-8")
        self.process = subprocess.Popen(
            [sys.executable, str(BRIDGE), "--sim", str(SIMULATOR), "--port", "0", "--app", self.dist.name, "--hostname", "zenit-a1b2"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.addCleanup(self.stop)
        first = self.process.stdout.readline().strip()
        self.assertRegex(first, r"^listening ws://127\.0\.0\.1:[0-9]+$")
        self.base = "http://" + first.split("://", 1)[1]

    def stop(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        self.process.stdout.close()
        self.process.stderr.close()

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path, timeout=5) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.headers, error.read()

    def test_the_page_and_its_files(self):
        status, headers, body = self.get("/")
        self.assertEqual((status, headers["Content-Type"], headers["Cache-Control"]), (200, "text/html; charset=utf-8", "no-cache"))
        self.assertIn(b"<title>Zenit</title>", body)
        status, headers, _ = self.get("/assets/app-abc.js")
        self.assertEqual((status, headers["Cache-Control"]), (200, "public, max-age=31536000, immutable"))

    def test_every_answer_has_the_security_headers(self):
        for path in ("/", "/board.json", "/missing"):
            _, headers, _ = self.get(path)
            for name, value in ws_bridge.SECURITY_HEADERS.items():
                self.assertEqual(headers[name], value, f"{path} {name}")

    def test_the_headers_are_the_boards(self):
        source = (ROOT / "lib" / "ZenitNet" / "src" / "net_http.cpp").read_text(encoding="utf-8")
        block = source[source.index("COMMON_HEADERS[] = {") : source.index("};", source.index("COMMON_HEADERS[] = {"))]
        board = {}
        for name, value in re.findall(r'\{"([A-Za-z-]+)",\s*((?:"(?:[^"\\]|\\.)*"\s*)+)\}', block):
            board[name] = "".join(re.findall(r'"((?:[^"\\]|\\.)*)"', value))
        self.assertEqual(board, ws_bridge.SECURITY_HEADERS)

    def test_other_methods_are_405_with_allow_get(self):
        import http.client

        host, port = self.base[len("http://") :].split(":")
        for method in ("POST", "HEAD", "PUT", "DELETE"):
            for path in ("/", "/board.json", "/assets/app-abc.js"):
                connection = http.client.HTTPConnection(host, int(port), timeout=5)
                # No body: the WebSocket library closes a connection whose handshake request has one, which the bridge
                # documents as its difference from a board (the board answers 405 to a request with a body too)
                connection.request(method, path)
                response = connection.getresponse()
                response.read()
                self.assertEqual(response.status, 405, f"{method} {path}")
                self.assertEqual(response.getheader("Allow"), "GET", f"{method} {path}")
                self.assertEqual(response.getheader("Content-Security-Policy"), ws_bridge.SECURITY_HEADERS["Content-Security-Policy"])
                connection.close()

    def test_board_json(self):
        status, headers, body = self.get("/board.json")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"zenit": True, "hostname": "zenit-a1b2", "ws": "/ws"})

    def test_what_is_not_served_is_404(self):
        for path in ("/missing", "/assets/", "/../index.html", "/assets/../index.html", "/%2e%2e/index.html", "/assets%5capp-abc.js"):
            self.assertEqual(self.get(path)[0], 404, path)

    def test_the_websocket_works_beside_the_page(self):
        with connect(self.base.replace("http://", "ws://") + "/ws", compression=None) as socket:
            socket.send(zenit.frame({"seq": 1, "cmd": "info"}).decode("utf-8"))
            reply = zenit.parse_line(socket.recv(timeout=5).encode("utf-8"))
            self.assertTrue(reply["ok"])
            # A page request does not need the WebSocket slot
            self.assertEqual(self.get("/")[0], 200)


@unittest.skipUnless(SIMULATOR.exists() or IN_CI, "needs the simulator program")
class SimulatorWifiTest(unittest.TestCase):
    """The simulator as a board on WiFi, driven through its standard input: login, the close request and the token."""

    TOKEN = "abcdefghij012345"

    def setUp(self):
        self.process = subprocess.Popen(
            [str(SIMULATOR), "--protocol", "--transport", "wifi"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True
        )
        self.addCleanup(self.stop)
        self.send_raw("!token " + self.TOKEN)
        self.send_raw("!wifi-open")
        self.seq = 0

    def stop(self):
        self.process.stdin.close()
        self.process.wait(timeout=5)
        self.process.stdout.close()

    def send_raw(self, line):
        self.process.stdin.write(line + "\n")
        self.process.stdin.flush()

    def ask(self, command, **fields):
        """The reply and whether the simulator asked to close the connection after it."""
        self.seq += 1
        self.send_raw(zenit.frame({"seq": self.seq, "cmd": command, **fields}).decode())
        # A control line that answers at once marks the end of what this request wrote
        self.send_raw("!update firmware 1 0")
        reply, closed = None, False
        for line in self.process.stdout:
            if line.startswith("!sha256"):
                break
            closed = closed or line.startswith("!close-client")
            parsed = zenit.parse_line(line.encode())
            if parsed is not None:
                reply = parsed
        return reply, closed

    def test_the_login_works_and_three_failures_ask_to_close(self):
        reply, _ = self.ask("settings_set", network_login=True)
        self.assertTrue(reply["ok"])
        self.assertNotIn("token", reply["settings"])
        reply, _ = self.ask("status")
        self.assertEqual(reply["error"], "unauthorized")
        reply, _ = self.ask("auth_challenge")
        digest = hmac.new(self.TOKEN.encode(), reply["nonce"].encode(), hashlib.sha256).hexdigest()
        reply, closed = self.ask("auth", hmac=digest)
        self.assertEqual((reply["ok"], closed), (True, False))
        self.assertTrue(self.ask("status")[0]["ok"])

    def test_three_failed_logins_ask_to_close(self):
        self.ask("settings_set", network_login=True)
        results = []
        for _ in range(3):
            self.ask("auth_challenge")
            results.append(self.ask("auth", hmac="0" * 64))
        self.assertEqual([(r["error"], closed) for r, closed in results], [("unauthorized", False)] * 2 + [("unauthorized", True)])

    def test_settings_reset_and_the_token_are_usb_only(self):
        for command in ("settings_reset", "wifi_forget", "token_regenerate"):
            self.assertEqual(self.ask(command)[0]["error"], "usb_only", command)
        self.assertNotIn("token", self.ask("settings_get")[0]["settings"])


class CloseRequestTest(unittest.TestCase):
    def test_the_simulator_names_the_close_code(self):
        self.assertEqual(ws_bridge.close_request("!close-client"), 1008)
        self.assertEqual(ws_bridge.close_request("!close-client 1012"), 1012)
        for text in ("!close-client x", "!close-client 99999", "!close-clients", "!sha256 1", "!close-client \u00b2"):
            self.assertIsNone(ws_bridge.close_request(text), text)


if __name__ == "__main__":
    unittest.main()
