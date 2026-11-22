# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests of the embedding of the web app: python3 -m unittest discover -s tools"""

import gzip
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import web_assets  # noqa: E402


class WebAssetsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dist = Path(self.tmp.name) / "dist"
        (self.dist / "assets").mkdir(parents=True)
        (self.dist / "index.html").write_text("<html></html>", encoding="utf-8")
        (self.dist / "assets" / "app-abc.js").write_text("console.log(1)", encoding="utf-8")
        (self.dist / "assets" / "app-abc.js.map").write_text("{}", encoding="utf-8")
        (self.dist / "favicon.svg").write_text("<svg/>", encoding="utf-8")

    def test_every_file_is_gzipped_with_its_type_and_cache_rule(self):
        files = web_assets.collect(self.dist)
        self.assertEqual([f[0] for f in files], ["assets/app-abc.js", "favicon.svg", "index.html"])
        by_path = {path: (media, data, immutable) for path, media, data, immutable in files}
        self.assertEqual(gzip.decompress(by_path["index.html"][1]), b"<html></html>")
        self.assertEqual(by_path["index.html"][0], "text/html; charset=utf-8")
        self.assertEqual(by_path["favicon.svg"][0], "image/svg+xml")
        self.assertTrue(by_path["assets/app-abc.js"][2])
        self.assertFalse(by_path["index.html"][2])

    def test_the_output_is_the_same_for_the_same_input(self):
        first = web_assets.render(web_assets.collect(self.dist), "net_http.h")
        second = web_assets.render(web_assets.collect(self.dist), "net_http.h")
        self.assertEqual(first, second)
        self.assertIn('{"index.html", "text/html; charset=utf-8", DATA_2, ', first)
        self.assertIn("extern const size_t COUNT = 3;", first)

    def test_an_unbuilt_web_app_is_refused(self):
        (self.dist / "index.html").unlink()
        with self.assertRaises(web_assets.AssetsError):
            web_assets.collect(self.dist)

    def test_a_file_with_no_known_type_is_refused(self):
        (self.dist / "data.bin").write_bytes(b"x")
        with self.assertRaises(web_assets.AssetsError):
            web_assets.collect(self.dist)

    def test_a_path_the_board_cannot_serve_is_refused(self):
        (self.dist / "a b.js").write_text("x", encoding="utf-8")
        with self.assertRaises(web_assets.AssetsError):
            web_assets.collect(self.dist)

    def test_the_source_is_written_only_when_it_changes(self):
        out = Path(self.tmp.name) / "gen" / "web_assets.cpp"
        args = ["--dist", str(self.dist), "--out", str(out), "--header", "net_http.h"]
        self.assertEqual(web_assets.main(args), 0)
        before = out.stat().st_mtime_ns
        self.assertEqual(web_assets.main(args), 0)
        self.assertEqual(out.stat().st_mtime_ns, before)

    def test_the_command_line_reports_an_unbuilt_app(self):
        (self.dist / "index.html").unlink()
        out = Path(self.tmp.name) / "web_assets.cpp"
        self.assertEqual(web_assets.main(["--dist", str(self.dist), "--out", str(out), "--header", "h.h"]), 1)
        self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
