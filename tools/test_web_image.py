# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests of the web image of the board's www partition: python3 -m unittest discover -s tools"""

import gzip
import hashlib
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import web_image  # noqa: E402


class WebImageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dist = Path(self.tmp.name) / "dist"
        (self.dist / "assets").mkdir(parents=True)
        (self.dist / "index.html").write_text("<html></html>", encoding="utf-8")
        (self.dist / "assets" / "app-abc.js").write_text("console.log(1)", encoding="utf-8")
        (self.dist / "assets" / "app-abc.js.map").write_text("{}", encoding="utf-8")
        (self.dist / "favicon.svg").write_text("<svg/>", encoding="utf-8")
        self.write_manifest(
            {
                "index.html": {"file": "assets/app-abc.js", "isEntry": True, "dynamicImports": [web_image.INSTALLER_ENTRY]},
            }
        )

    def write_manifest(self, chunks):
        chunks.setdefault(web_image.INSTALLER_ENTRY, {"file": "assets/installer-1.js", "isDynamicEntry": True})
        (self.dist / ".vite").mkdir(exist_ok=True)
        (self.dist / ".vite" / "manifest.json").write_text(json.dumps(chunks), encoding="utf-8")
        for chunk in chunks.values():
            for name in [chunk["file"], *chunk.get("css", [])]:
                if not (self.dist / name).exists():
                    (self.dist / name).write_text("x", encoding="utf-8")

    def test_every_file_is_gzipped_with_its_type_and_cache_rule(self):
        files = web_image.collect(self.dist)
        self.assertEqual([f[0] for f in files], ["assets/app-abc.js", "favicon.svg", "index.html"])
        by_path = {path: (media, data, immutable) for path, media, data, immutable in files}
        self.assertEqual(gzip.decompress(by_path["index.html"][1]), b"<html></html>")
        self.assertEqual(by_path["index.html"][0], "text/html; charset=utf-8")
        self.assertEqual(by_path["favicon.svg"][0], "image/svg+xml")
        self.assertTrue(by_path["assets/app-abc.js"][2])
        self.assertFalse(by_path["index.html"][2])

    def test_the_files_only_the_installer_uses_are_left_out(self):
        self.write_manifest(
            {
                "index.html": {
                    "file": "assets/app-abc.js",
                    "isEntry": True,
                    "imports": ["_shared"],
                    "dynamicImports": [web_image.INSTALLER_ENTRY, "src/lazy.tsx"],
                },
                "src/lazy.tsx": {"file": "assets/lazy-2.js", "isDynamicEntry": True},
                "_shared": {"file": "assets/shared-3.js", "css": ["assets/shared-3.css"]},
                web_image.INSTALLER_ENTRY: {
                    "file": "assets/installer-1.js",
                    "isDynamicEntry": True,
                    "imports": ["_shared"],
                    "dynamicImports": ["_stub"],
                    "css": ["assets/installer-1.css"],
                },
                "_stub": {"file": "assets/stub-4.js"},
            }
        )
        paths = [f[0] for f in web_image.collect(self.dist)]
        self.assertEqual(
            paths,
            ["assets/app-abc.js", "assets/lazy-2.js", "assets/shared-3.css", "assets/shared-3.js", "favicon.svg", "index.html"],
        )

    def test_a_build_without_its_manifest_is_refused(self):
        (self.dist / ".vite" / "manifest.json").unlink()
        with self.assertRaises(web_image.AssetsError):
            web_image.collect(self.dist)

    def test_a_manifest_without_the_installer_is_refused(self):
        (self.dist / ".vite" / "manifest.json").write_text(
            json.dumps({"index.html": {"file": "assets/app-abc.js", "isEntry": True}}), encoding="utf-8"
        )
        with self.assertRaises(web_image.AssetsError):
            web_image.collect(self.dist)

    def test_the_image_of_one_page_has_the_layout_of_the_specification(self):
        page = gzip.compress(b"<html></html>", mtime=0)
        image = web_image.build_image([("index.html", "text/html; charset=utf-8", page, False)], "1.2.3", 1, 2)
        # Header: magic, format 1, protocols 1 to 2, reserved, version zero-padded to 16 bytes, one file, reserved,
        # body size, SHA-256 of the body, then zeros to 4,096 bytes.
        self.assertEqual(image[0:8], b"ZWEB\x01\x01\x02\x00")
        self.assertEqual(image[8:24], b"1.2.3" + bytes(11))
        self.assertEqual(image[24:28], b"\x01\x00\x00\x00")
        # One index entry: 1 + 10 + 1 (path) + 1 + 24 + 1 (media type) + 8 (offset, length) = 46 bytes, then the page.
        body = image[4096:]
        self.assertEqual(struct.unpack("<I", image[28:32])[0], 46 + len(page))
        self.assertEqual(image[32:64], hashlib.sha256(body).digest())
        self.assertEqual(image[64:4096], bytes(4096 - 64))
        self.assertEqual(body[0:12], b"\x0aindex.html\x00")
        self.assertEqual(body[12:38], b"\x18text/html; charset=utf-8\x00")
        self.assertEqual(struct.unpack("<II", body[38:46]), (46, len(page)))
        self.assertEqual(body[46:], page)

    def test_the_reader_applies_the_board_rules(self):
        page = [("index.html", "text/html; charset=utf-8", b"page", False)]
        good = web_image.build_image(page + [("a.js", "text/javascript", b"js", False)], "1.2.3", 1, 1)
        self.assertEqual(web_image.read_image(good), ("1.2.3", 1, 1))

        def rehashed(image):
            image = bytearray(image)
            image[32:64] = hashlib.sha256(bytes(image[4096:])).digest()
            return bytes(image)

        broken = {
            "duplicate path": web_image.build_image(page + page, "1.2.3", 1, 1),
            "no index.html": web_image.build_image([("a.html", "text/html", b"x", False)], "1.2.3", 1, 1),
            "body hash": good[:-1] + bytes([good[-1] ^ 1]),
            "version": rehashed(good[:8] + b"1..2" + bytes(12) + good[24:]),
            "reserved": good[:7] + b"\x01" + good[8:],
            # index.html's entry: 1 + 10 + 1 + 1 + 24 + 1 bytes of texts, then its offset (4 bytes) and length (4 bytes)
            "file outside": rehashed(good[: 4096 + 42] + struct.pack("<I", 9999) + good[4096 + 46 :]),
        }
        for name, image in broken.items():
            with self.subTest(name=name), self.assertRaises(web_image.AssetsError):
                web_image.read_image(image)

    def test_the_output_is_the_same_for_the_same_input(self):
        first = web_image.build_image(web_image.collect(self.dist), "1.0.0", 1, 1)
        second = web_image.build_image(web_image.collect(self.dist), "1.0.0", 1, 1)
        self.assertEqual(first, second)
        self.assertEqual(web_image.read_header(first), ("1.0.0", 1, 1))

    def test_a_version_that_is_not_a_release_is_refused(self):
        for version in ("1.2", "1.2.3-rc.1", "01.2.3", "123456.123456.1234", "1000000.0.0"):
            with self.subTest(version=version), self.assertRaises(web_image.AssetsError):
                web_image.build_image(web_image.collect(self.dist), version, 1, 1)

    def test_an_image_larger_than_the_partition_is_refused(self):
        big = [("index.html", "text/html; charset=utf-8", bytes(web_image.PARTITION_SIZE), False)]
        with self.assertRaises(web_image.AssetsError):
            web_image.build_image(big, "1.0.0", 1, 1)

    def test_the_range_file_is_checked(self):
        path = Path(self.tmp.name) / "speaks.json"
        for text in ('{"protocol_min":2,"protocol_max":1}', '{"protocol_min":0,"protocol_max":1}', '{"protocol_min":1}',
                     '{"protocol_min":true,"protocol_max":1}'):
            path.write_text(text, encoding="utf-8")
            with self.subTest(text=text), self.assertRaises(web_image.AssetsError):
                web_image.read_range(path)
        path.write_text('{"protocol_min":1,"protocol_max":3}', encoding="utf-8")
        self.assertEqual(web_image.read_range(path), (1, 3))

    def test_the_repository_range_holds_the_firmware_protocol(self):
        low, high = web_image.read_range()
        self.assertTrue(low <= web_image.firmware_protocol() <= high)

    def test_an_unbuilt_web_app_is_refused(self):
        (self.dist / "index.html").unlink()
        with self.assertRaises(web_image.AssetsError):
            web_image.collect(self.dist)

    def test_a_file_with_no_known_type_is_refused(self):
        (self.dist / "data.bin").write_bytes(b"x")
        with self.assertRaises(web_image.AssetsError):
            web_image.collect(self.dist)

    def test_a_path_the_board_cannot_serve_is_refused(self):
        for name in ("a b.js", "a..b.js"):
            path = self.dist / name
            path.write_text("x", encoding="utf-8")
            with self.subTest(name=name), self.assertRaises(web_image.AssetsError):
                web_image.collect(self.dist)
            path.unlink()

    def test_the_command_line_writes_the_image(self):
        out = Path(self.tmp.name) / "out" / "zenit-web-1.0.0.bin"
        self.assertEqual(web_image.main(["--dist", str(self.dist), "--version", "1.0.0", "--out", str(out)]), 0)
        self.assertEqual(web_image.read_header(out.read_bytes())[0], "1.0.0")

    def test_the_command_line_refuses_an_app_that_does_not_speak_the_firmware_protocol(self):
        path = Path(self.tmp.name) / "speaks.json"
        path.write_text('{"protocol_min":2,"protocol_max":3}', encoding="utf-8")
        header = Path(self.tmp.name) / "proto_limits.h"
        header.write_text("constexpr uint8_t PROTOCOL_VERSION = 1;\n", encoding="utf-8")
        out = Path(self.tmp.name) / "image.bin"
        args = ["--dist", str(self.dist), "--version", "1.0.0", "--out", str(out), "--range", str(path)]
        self.assertEqual(web_image.main(args + ["--protocol-header", str(header)]), 1)
        self.assertFalse(out.exists())

    def test_the_command_line_reports_an_unbuilt_app(self):
        (self.dist / "index.html").unlink()
        out = Path(self.tmp.name) / "image.bin"
        self.assertEqual(web_image.main(["--dist", str(self.dist), "--version", "1.0.0", "--out", str(out)]), 1)
        self.assertFalse(out.exists())


CASES = Path(__file__).resolve().parent.parent / "conformance" / "update" / "web_image.json"


def image_of(case):
    """The bytes of a conformance case: the header from its fields, then the body and any tail."""
    h = case["header"]
    body = bytes.fromhex(case["body_hex"])
    header = bytearray(web_image.HEADER_SIZE)
    header[0:4] = h["magic"].encode()
    header[4], header[5], header[6], header[7] = h["format"], h["protocol_min"], h["protocol_max"], h.get("reserved7", 0)
    header[8 : 8 + len(h["version"])] = h["version"].encode()
    struct.pack_into("<H", header, 24, h["count"])
    header[26] = header[27] = h.get("reserved26", 0)
    struct.pack_into("<I", header, 28, h["body_size"])
    header[32:64] = hashlib.sha256(body).digest() if h["sha256"] == "of_body" else bytes.fromhex(h["sha256"])
    return bytes(header) + body + bytes.fromhex(case.get("tail_hex", ""))


class ConformanceTest(unittest.TestCase):
    def test_the_tools_read_images_as_the_cases_say(self):
        for case in json.loads(CASES.read_text(encoding="utf-8"))["cases"]:
            with self.subTest(case=case["note"]):
                image = image_of(case)
                if case.get("valid_as_file", case["valid"]):
                    self.assertEqual(web_image.read_image(image)[0], case["header"]["version"])
                else:
                    with self.assertRaises(web_image.AssetsError):
                        web_image.read_image(image)


if __name__ == "__main__":
    unittest.main()
