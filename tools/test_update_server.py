# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests of the update test server: python3 -m unittest discover -s tools"""

import hashlib
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import update_server  # noqa: E402
import release_assets as assets  # noqa: E402

FIRMWARE = b"firmware " * 10000


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), update_server.handler_for("1.2.0", FIRMWARE))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path, timeout=5) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            error.close()
            return error.code, b""

    def test_the_manifest_describes_the_file_it_serves(self):
        status, body = self.get("/firmware/update.json")
        manifest = json.loads(body)
        self.assertEqual(status, 200)
        status, file = self.get("/firmware/" + assets.FIRMWARE_NAME)
        self.assertEqual(status, 200)
        self.assertEqual(file, FIRMWARE)
        self.assertEqual((manifest["version"], manifest["size"], manifest["sha256"]), ("1.2.0", len(FIRMWARE), hashlib.sha256(FIRMWARE).hexdigest()))
        self.assertEqual(manifest["file"], assets.FIRMWARE_NAME)

    def test_nothing_else_is_served(self):
        for path in ("/", "/firmware/", "/firmware/other.bin", "/../etc/passwd"):
            self.assertEqual(self.get(path)[0], 404, path)


class WebServerTest(ServerTest):
    def setUp(self):
        import web_image

        self.image = web_image.build_image([("index.html", "text/html; charset=utf-8", b"page", False)], "1.3.0", 1, 1)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), update_server.handler_for(None, None, self.image))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def test_the_manifest_describes_the_file_it_serves(self):
        status, body = self.get("/web/update.json")
        self.assertEqual(status, 200)
        manifest = json.loads(body)
        self.assertEqual((manifest["version"], manifest["file"]), ("1.3.0", "zenit-web-1.3.0.bin"))
        status, file = self.get("/web/zenit-web-1.3.0.bin")
        self.assertEqual((status, file), (200, self.image))
        self.assertEqual(manifest["sha256"], hashlib.sha256(self.image).hexdigest())
        self.assertEqual(self.get("/firmware/update.json")[0], 404)


class MainTest(unittest.TestCase):
    def test_nothing_to_serve_is_refused(self):
        self.assertEqual(update_server.main([]), 1)

    def test_a_file_that_is_not_a_web_image_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "bad.bin"
            bad.write_bytes(b"x" * 5000)
            self.assertEqual(update_server.main(["--web", str(bad)]), 1)

    def test_a_bad_version_or_file_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            small = Path(tmp) / "small.bin"
            small.write_bytes(b"x")
            self.assertEqual(update_server.main(["--version", "1.2", "--firmware", str(small)]), 1)
            self.assertEqual(update_server.main(["--version", "1.2.3", "--firmware", str(small)]), 1)
            self.assertEqual(update_server.main(["--version", "1.2.3", "--firmware", str(Path(tmp) / "none.bin")]), 1)


if __name__ == "__main__":
    unittest.main()
