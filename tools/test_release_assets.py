# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests of tools/release_assets.py: python3 -m unittest discover -s tools"""

import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import release_assets as assets  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

PARTITIONS = """# comment
# Name,   Type, SubType,  Offset,   Size,     Flags
nvs,      data, nvs,      0x9000,   0x5000,
otadata,  data, ota,      0xe000,   0x2000,
app0,     app,  ota_0,    0x10000,  0x100,
app1,     app,  ota_1,    0x200000, 0x100,
"""


class MergeTest(unittest.TestCase):
    def test_parts_sit_at_their_offsets_with_ff_between(self):
        image = assets.merge_factory([(0, b"AB"), (4, b"CD"), (8, b"E")])
        self.assertEqual(image, b"AB\xff\xffCD\xff\xffE")

    def test_the_order_of_the_parts_does_not_matter(self):
        self.assertEqual(assets.merge_factory([(4, b"CD"), (0, b"AB")]), b"AB\xff\xffCD")

    def test_overlapping_parts_fail(self):
        with self.assertRaises(assets.ReleaseError):
            assets.merge_factory([(0, b"ABC"), (2, b"D")])

    def test_touching_parts_are_fine(self):
        self.assertEqual(assets.merge_factory([(0, b"AB"), (2, b"CD")]), b"ABCD")


class SlotTest(unittest.TestCase):
    def test_the_first_application_slot(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "partitions.csv"
            path.write_text(PARTITIONS)
            self.assertEqual(assets.app_slot(path), (0x10000, 0x100))

    def test_the_real_layout(self):
        self.assertEqual(assets.app_slot(ROOT / "partitions.csv"), (0x10000, 0x1F0000))

    def test_no_slot_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "partitions.csv"
            path.write_text("nvs, data, nvs, 0x9000, 0x5000,\n")
            with self.assertRaises(assets.ReleaseError):
                assets.app_slot(path)

    def test_the_real_offsets_match_the_partition_table(self):
        # The factory image puts the application at the slot's offset and the table where the chip looks for it
        self.assertEqual(assets.app_slot(ROOT / "partitions.csv")[0], 0x10000)
        self.assertEqual(assets.PARTITION_TABLE_OFFSET, 0x8000)
        # nvs starts at 0x9000, right after the 4 KiB table at 0x8000; otadata at 0xe000 is where boot_app0 goes
        text = (ROOT / "partitions.csv").read_text()
        self.assertIn("otadata,  data, ota,      0xe000", text)
        self.assertEqual(assets.BOOT_APP0_OFFSET, 0xE000)


class AssetsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.build = root / "build"
        self.build.mkdir()
        (self.build / "bootloader.bin").write_bytes(b"BOOT")
        (self.build / "partitions.bin").write_bytes(b"TABLE")
        (self.build / "firmware.bin").write_bytes(b"APP-1.2.3-APP")
        self.boot_app0 = root / "boot_app0.bin"
        self.boot_app0.write_bytes(b"OTADATA")
        self.partitions = root / "partitions.csv"
        self.partitions.write_text(PARTITIONS)
        self.out = root / "out"
        self.notices = root / "notices.txt"
        self.notices.write_text("NOTICES")

    def make(self, version="1.2.3", notices=True):
        return assets.make_assets(
            version, self.build, self.boot_app0, self.out, self.partitions, self.notices if notices else None
        )

    def test_the_files_are_written(self):
        names = self.make()
        self.assertEqual(
            names,
            ["zenit-esp32c3-factory.bin", "zenit-esp32c3-firmware.bin", "THIRD_PARTY_NOTICES.txt", "SHA256SUMS"],
        )
        factory = (self.out / "zenit-esp32c3-factory.bin").read_bytes()
        self.assertEqual(factory[0:4], b"BOOT")
        self.assertEqual(factory[0x8000 : 0x8000 + 5], b"TABLE")
        self.assertEqual(factory[0xE000 : 0xE000 + 7], b"OTADATA")
        self.assertEqual(factory[0x10000:], b"APP-1.2.3-APP")
        self.assertEqual(set(factory[4:0x8000]), {0xFF})
        self.assertEqual((self.out / "zenit-esp32c3-firmware.bin").read_bytes(), b"APP-1.2.3-APP")
        self.assertEqual((self.out / "THIRD_PARTY_NOTICES.txt").read_text(), "NOTICES")

    def test_the_checksums_match_the_files(self):
        self.make()
        lines = (self.out / "SHA256SUMS").read_text().splitlines()
        self.assertEqual(len(lines), 3)
        for line in lines:
            digest, name = line.split("  ")
            self.assertEqual(digest, hashlib.sha256((self.out / name).read_bytes()).hexdigest())

    def test_without_notices_there_is_no_notices_file(self):
        self.assertEqual(self.make(notices=False)[-2:], ["zenit-esp32c3-firmware.bin", "SHA256SUMS"])
        self.assertFalse((self.out / "THIRD_PARTY_NOTICES.txt").exists())

    def test_an_application_without_the_version_fails(self):
        with self.assertRaisesRegex(assets.ReleaseError, "does not carry the version 9.9.9"):
            self.make("9.9.9")

    def test_an_application_too_big_for_its_slot_fails(self):
        (self.build / "firmware.bin").write_bytes(b"APP-1.2.3-" + b"x" * 0x100)
        with self.assertRaisesRegex(assets.ReleaseError, "its slot"):
            self.make()

    def test_a_missing_part_fails(self):
        (self.build / "bootloader.bin").unlink()
        with self.assertRaisesRegex(assets.ReleaseError, "bootloader not found"):
            self.make()

    def test_a_bad_version_fails(self):
        for version in ("", "1 2", "../x", "1.2.3\n"):
            with self.assertRaises(assets.ReleaseError):
                self.make(version)

    def test_main_reports_errors(self):
        with self.assertRaises(SystemExit) as raised:
            assets.main(["--version", "1.2.3", "--out", str(self.out), "--build-dir", str(self.build / "missing")])
        self.assertIn("release_assets:", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
