# SPDX-License-Identifier: GPL-3.0-or-later
"""The limits the tools copy from the firmware are equal to the firmware's: python3 -m unittest discover -s tools

The tools cannot include the C++ headers, so each copies the values it needs. A limit changed on one side only would let
the site publish what the board refuses, or refuse what it accepts.
"""

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pages_site  # noqa: E402
import release_assets  # noqa: E402
import web_image  # noqa: E402
import ws_bridge  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def constant(header, name):
    """The value of `constexpr <type> NAME = <number>;` in a header under lib/, decimal or hexadecimal."""
    text = (ROOT / "lib" / header).read_text(encoding="utf-8")
    match = re.search(rf"\bconstexpr [a-z0-9_ ]+ {name} = (0[xX][0-9a-fA-F]+|[0-9]+);", text)
    if match is None:
        raise AssertionError(f"{name} is not a numeric constexpr in lib/{header}")
    return int(match.group(1), 0)


def partition_size(name):
    """The size of the partition `name` in partitions.csv."""
    for line in (ROOT / "partitions.csv").read_text(encoding="utf-8").splitlines():
        fields = [field.strip() for field in line.split("#", 1)[0].split(",")]
        if len(fields) >= 5 and fields[0] == name:
            return int(fields[4], 0)
    raise AssertionError(f"partitions.csv has no partition {name}")


class LimitsTest(unittest.TestCase):
    def test_the_update_manifest_limits(self):
        self.assertEqual(pages_site.MAX_UPDATE_MANIFEST, constant("ZenitUpdate/src/manifest.h", "MAX_MANIFEST"))
        self.assertEqual(pages_site.MIN_FIRMWARE_SIZE, constant("ZenitUpdate/src/manifest.h", "MIN_FIRMWARE_SIZE"))

    def test_the_firmware_slot(self):
        slot = constant("ZenitUpdate/src/manifest.h", "SLOT_SIZE")
        self.assertEqual(release_assets.app_slot(ROOT / "partitions.csv")[1], slot)
        self.assertEqual(partition_size("app1"), slot)

    def test_the_web_image_limits(self):
        header = "ZenitNet/src/web_image.h"
        self.assertEqual(web_image.HEADER_SIZE, constant(header, "WEB_HEADER_SIZE"))
        self.assertEqual(web_image.PARTITION_SIZE, constant(header, "WEB_PARTITION_SIZE"))
        self.assertEqual(web_image.PARTITION_SIZE, partition_size("www"))
        self.assertEqual(web_image.MAX_FILES, constant(header, "MAX_WEB_FILES"))
        self.assertEqual(web_image.MAX_PATH, constant(header, "MAX_WEB_PATH"))
        self.assertEqual(web_image.MAX_MEDIA_TYPE, constant(header, "MAX_WEB_MEDIA_TYPE"))
        self.assertEqual(web_image.VERSION_FIELD, constant(header, "WEB_VERSION_FIELD"))
        self.assertEqual(web_image.FORMAT, constant(header, "WEB_IMAGE_FORMAT"))

    def test_the_line_and_origin_limits_of_the_simulator_bridge(self):
        self.assertEqual(ws_bridge.BOARD_MAX_LINE, constant("ZenitProto/src/proto_limits.h", "MAX_LINE"))
        self.assertEqual(ws_bridge.MAX_ORIGIN, constant("ZenitNet/src/origin_scan.h", "MAX_ORIGIN"))


if __name__ == "__main__":
    unittest.main()
