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
# The application is large enough for a board to install it (the update manifest refuses less)
FIRMWARE = pages_site.assets.FIRMWARE_NAME
PARTS[FIRMWARE] = b"zenit firmware " * 5000
# The protocol the firmware release speaks
PROTOCOL = pages_site.assets.PROTOCOL_NAME


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
        files = dict(PARTS, **{PROTOCOL: b"1\n"})
        for name, data in files.items():
            (self.release / name).write_bytes(data)
        self.write_sums()
        self.out = self.root / "site"

    def write_sums(self):
        """SHA256SUMS of the release files as they are now, as the release job writes it."""
        files = sorted(path for path in self.release.iterdir() if path.name != "SHA256SUMS")
        sums = "".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n" for path in files)
        (self.release / "SHA256SUMS").write_text(sums, encoding="utf-8")

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

    def test_the_update_manifest_describes_the_application_file(self):
        self.build()
        text = (self.out / "firmware" / "update.json").read_text(encoding="utf-8")
        self.assertEqual(text.count("\n"), 1)
        self.assertLessEqual(len(text), pages_site.MAX_UPDATE_MANIFEST)
        self.assertEqual(
            json.loads(text),
            {
                "schema": 1,
                "board": "esp32c3",
                "version": "1.2.3",
                "file": FIRMWARE,
                "size": len(PARTS[FIRMWARE]),
                "sha256": hashlib.sha256(PARTS[FIRMWARE]).hexdigest(),
            },
        )
        # Compact, as the board's strict reader and the conformance cases have it
        self.assertNotIn(" ", text.strip())

    def test_a_firmware_the_board_would_refuse_is_not_published(self):
        (self.release / FIRMWARE).write_bytes(b"small")
        self.write_sums()
        with self.assertRaisesRegex(pages_site.SiteError, "a board updates only to a file of"):
            self.build()

    def test_the_manifest_is_the_one_the_web_app_accepts(self):
        # The same rules as web/src/release/manifest.ts, readManifest
        manifest = pages_site.manifest("0.1.0")
        self.assertEqual(manifest["name"], "Zenit")
        self.assertRegex(manifest["version"], r"^[0-9]+\.[0-9]+\.[0-9]+$")
        self.assertIn("ESP32-C3", [build["chipFamily"] for build in manifest["builds"]])
        # and the web app's own fixture is the same shape
        fixture = json.loads((Path(__file__).resolve().parent.parent / "web/e2e/site/firmware/manifest.json").read_text())
        self.assertEqual(fixture["builds"], pages_site.manifest("0.1.0", with_web=True)["builds"])
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

    def web_image(self, version="1.4.0", low=1, high=2):
        import web_image

        path = self.root / f"zenit-web-{version}.bin"
        path.write_bytes(
            web_image.build_image([("index.html", "text/html; charset=utf-8", b"page", False)], version, low, high)
        )
        return path

    def test_the_web_image_and_its_manifest_are_under_web(self):
        image = self.web_image()
        self.build(web_image_path=image)
        data = image.read_bytes()
        self.assertEqual((self.out / "web" / "zenit-web-1.4.0.bin").read_bytes(), data)
        text = (self.out / "web" / "update.json").read_text(encoding="utf-8")
        self.assertEqual(
            json.loads(text),
            {
                "schema": 1,
                "version": "1.4.0",
                "file": "zenit-web-1.4.0.bin",
                "size": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
                "protocol_min": 1,
                "protocol_max": 2,
            },
        )
        self.assertEqual(list(json.loads(text)), ["schema", "version", "file", "size", "sha256", "protocol_min", "protocol_max"])
        self.assertNotIn(" ", text.strip())

    def test_the_installer_writes_the_web_image_at_the_www_offset(self):
        self.build(web_image_path=self.web_image())
        manifest = json.loads((self.out / "firmware" / "manifest.json").read_text(encoding="utf-8"))
        parts = manifest["builds"][0]["parts"]
        self.assertEqual(parts[-1], {"path": "zenit-web.bin", "offset": 0x370000})
        self.assertEqual(len(parts), 5)
        self.assertEqual((self.out / "firmware" / "zenit-web.bin").read_bytes(), self.web_image().read_bytes())

    def test_without_a_web_image_the_installer_writes_the_firmware_alone(self):
        self.build()
        manifest = json.loads((self.out / "firmware" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(len(manifest["builds"][0]["parts"]), 4)
        self.assertFalse((self.out / "web").exists())

    def test_a_file_that_is_not_a_web_image_is_refused(self):
        bad = self.root / "bad.bin"
        bad.write_bytes(b"not an image" * 1000)
        with self.assertRaises(pages_site.SiteError):
            self.build(web_image_path=bad)
        self.assertFalse(self.out.exists())

    def test_a_web_app_that_does_not_speak_the_firmware_protocol_is_not_paired_with_it(self):
        image = self.web_image(low=2, high=3)
        with self.assertRaises(pages_site.SiteError):
            self.build(web_image_path=image)
        self.assertFalse(self.out.exists())
        # without the firmware the site has nothing to pair it with
        self.build(web_image_path=image, firmware=None, firmware_version=None)
        self.assertTrue((self.out / "web" / "update.json").is_file())

    def test_a_firmware_release_without_its_protocol_is_refused_with_a_web_app(self):
        (self.release / PROTOCOL).unlink()
        with self.assertRaises(pages_site.SiteError):
            self.build(web_image_path=self.web_image())

    def test_an_image_that_breaks_the_board_rules_is_refused(self):
        import web_image

        good = self.web_image().read_bytes()
        broken_body = bytearray(good)
        broken_body[-1] ^= 1  # the SHA-256 of the body no longer matches
        no_index = web_image.build_image([("app.html", "text/html", b"page", False)], "1.4.0", 1, 2)
        for name, data in (("body.bin", bytes(broken_body)), ("index.bin", no_index), ("long.bin", good + b"\0")):
            path = self.root / name
            path.write_bytes(data)
            with self.subTest(name=name), self.assertRaises(pages_site.SiteError):
                pages_site.checked_web_image(path)

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

    def test_the_checksums_are_required(self):
        (self.release / "SHA256SUMS").unlink()
        with self.assertRaisesRegex(pages_site.SiteError, "SHA256SUMS is missing"):
            self.build()
        self.assertFalse(self.out.exists())

    def test_the_parts_are_required(self):
        (self.release / pages_site.assets.FIRMWARE_NAME).unlink()
        with self.assertRaisesRegex(pages_site.SiteError, "is missing"):
            self.build()

    def test_a_version_the_board_cannot_read_is_refused(self):
        # Six digits at most in each part, as the board reads a version (web_image.VERSION)
        with self.assertRaisesRegex(pages_site.SiteError, "not X.Y.Z"):
            self.build(firmware_version="1234567.0.0")

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
