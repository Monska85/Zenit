# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests of the GitHub Pages assembly: python3 -m unittest discover -s tools"""

import hashlib
import io
import json
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pages_site  # noqa: E402

PARTS = {name: name.encode() + b" bytes" for name, _ in pages_site.parts()}


def make_archive(path, files, extra=None):
    with tarfile.open(path, "w:gz") as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
        for info in extra or []:
            tar.addfile(info)


class SiteTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        self.web = self.root / "zenit-web-1.0.0.tar.gz"
        make_archive(self.web, {"index.html": b"<html></html>", "assets/app.js": b"1", "THIRD_PARTY_NOTICES.txt": b"n"})
        self.release = self.root / "release"
        self.release.mkdir()
        for name, data in PARTS.items():
            (self.release / name).write_bytes(data)
        sums = "".join(f"{hashlib.sha256(data).hexdigest()}  {name}\n" for name, data in PARTS.items())
        (self.release / "SHA256SUMS").write_text(sums, encoding="utf-8")
        self.out = self.root / "site"

    def build(self, **overrides):
        args = {"web": self.web, "out": self.out, "firmware": self.release, "firmware_version": "1.2.3"}
        args.update(overrides)
        pages_site.assemble(**args)

    def test_the_app_is_at_the_root_and_the_firmware_under_firmware(self):
        self.build()
        self.assertEqual((self.out / "index.html").read_bytes(), b"<html></html>")
        self.assertEqual((self.out / "assets" / "app.js").read_bytes(), b"1")
        for name, data in PARTS.items():
            self.assertEqual((self.out / "firmware" / name).read_bytes(), data)
        self.assertTrue((self.out / ".nojekyll").is_file())

    def test_the_manifest_is_what_esp_web_tools_reads(self):
        self.build()
        manifest = json.loads((self.out / "firmware" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(
            manifest,
            {
                "name": "Zenit",
                "version": "1.2.3",
                "new_install_prompt_erase": True,
                "builds": [
                    {
                        "chipFamily": "ESP32-C3",
                        "parts": [
                            {"path": "zenit-esp32c3-bootloader.bin", "offset": 0},
                            {"path": "zenit-esp32c3-partitions.bin", "offset": 0x8000},
                            {"path": "zenit-esp32c3-boot_app0.bin", "offset": 0xE000},
                            {"path": "zenit-esp32c3-firmware.bin", "offset": 0x10000},
                        ],
                    }
                ],
            },
        )

    def test_the_manifest_is_the_one_the_web_app_accepts(self):
        # The same rules as web/src/release/manifest.ts, readManifest
        manifest = pages_site.manifest("0.1.0")
        self.assertEqual(manifest["name"], "Zenit")
        self.assertRegex(manifest["version"], r"^[0-9]+\.[0-9]+\.[0-9]+$")
        self.assertIn("ESP32-C3", [build["chipFamily"] for build in manifest["builds"]])
        # and the web app's own fixture is the same shape
        fixture = json.loads((Path(__file__).resolve().parent.parent / "web/e2e/site/firmware/manifest.json").read_text())
        self.assertEqual(fixture["builds"], manifest["builds"])
        self.assertEqual(fixture["name"], manifest["name"])
        self.assertEqual(fixture["new_install_prompt_erase"], manifest["new_install_prompt_erase"])

    def test_the_parts_leave_the_settings_memory_alone_and_match_the_partition_table(self):
        # nvs is 0x9000 to 0xDFFF (partitions.csv): the table ends at 0x9000, otadata starts at 0xE000
        table = (Path(__file__).resolve().parent.parent / "partitions.csv").read_text(encoding="utf-8")
        self.assertIn("nvs,      data, nvs,      0x9000,   0x5000", table)
        self.assertIn("otadata,  data, ota,      0xe000", table)
        for (name, offset), size in zip(pages_site.parts(), [len(PARTS[n]) for n, _ in pages_site.parts()]):
            self.assertTrue(offset + size <= 0x9000 or offset >= 0xE000, name)
        self.assertEqual(pages_site.parts()[3][1], 0x10000)

    def test_a_site_without_firmware_holds_the_app_alone(self):
        self.build(firmware=None, firmware_version=None)
        self.assertTrue((self.out / "index.html").is_file())
        self.assertFalse((self.out / "firmware").exists())

    def test_firmware_and_its_version_go_together(self):
        with self.assertRaises(pages_site.SiteError):
            self.build(firmware_version=None)
        with self.assertRaises(pages_site.SiteError):
            self.build(firmware=None)

    def test_the_version_must_be_x_y_z(self):
        for bad in ["1.2", "v1.2.3", "1.2.3-rc1", "01.2.3", "", "1.2.3\n"]:
            with self.assertRaises(pages_site.SiteError, msg=bad):
                self.build(firmware_version=bad)
        self.assertFalse(self.out.exists())

    def test_a_factory_image_that_does_not_match_its_checksums_is_refused(self):
        (self.release / pages_site.assets.BOOT_APP0_NAME).write_bytes(b"tampered")
        with self.assertRaises(pages_site.SiteError):
            self.build()
        self.assertFalse(self.out.exists())

    def test_checksums_are_optional_but_the_parts_are_not(self):
        (self.release / "SHA256SUMS").unlink()
        self.build()
        (self.release / pages_site.assets.FIRMWARE_NAME).unlink()
        with self.assertRaises(pages_site.SiteError):
            self.build(out=self.root / "other")

    def test_an_archive_without_an_index_is_refused(self):
        make_archive(self.web, {"assets/app.js": b"1"})
        with self.assertRaises(pages_site.SiteError):
            self.build()
        self.assertFalse(self.out.exists())

    def test_a_file_that_is_not_an_archive_is_refused(self):
        self.web.write_bytes(b"not a tar")
        with self.assertRaises(pages_site.SiteError):
            self.build()

    def test_an_archive_cannot_write_outside_the_site(self):
        make_archive(self.web, {"index.html": b"x", "../escaped.txt": b"x"})
        with self.assertRaises(pages_site.SiteError):
            self.build()
        self.assertFalse((self.root / "escaped.txt").exists())
        link = tarfile.TarInfo("link")
        link.type = tarfile.SYMTYPE
        link.linkname = "/etc/passwd"
        make_archive(self.web, {"index.html": b"x"}, extra=[link])
        with self.assertRaises(pages_site.SiteError):
            self.build(out=self.root / "second")

    def test_a_folder_that_is_not_empty_is_not_overwritten(self):
        self.out.mkdir()
        (self.out / "keep.txt").write_text("keep", encoding="utf-8")
        with self.assertRaises(pages_site.SiteError):
            self.build()
        self.assertEqual((self.out / "keep.txt").read_text(encoding="utf-8"), "keep")

    def test_the_command_line_reports_a_problem_with_status_1(self):
        stderr = io.StringIO()
        real, sys.stderr = sys.stderr, stderr
        try:
            status = pages_site.main(["--web", str(self.root / "missing.tar.gz"), "--out", str(self.out)])
        finally:
            sys.stderr = real
        self.assertEqual(status, 1)
        self.assertIn("pages_site:", stderr.getvalue())

    def test_the_command_line_makes_the_site(self):
        status = pages_site.main(
            ["--web", str(self.web), "--out", str(self.out), "--firmware", str(self.release), "--firmware-version", "1.2.3"]
        )
        self.assertEqual(status, 0)
        self.assertTrue((self.out / "firmware" / "manifest.json").is_file())


if __name__ == "__main__":
    unittest.main()
