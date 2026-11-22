#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""The files attached to a GitHub Release of the firmware.

    tools/release_assets.py --version 1.2.3 --out release/ [--notices THIRD_PARTY_NOTICES.txt]

Takes the build of the `esp32c3` environment and writes, into the output folder:

  zenit-esp32c3-factory.bin   the whole flash in one image, to write at address 0 on a blank or old board:
                              bootloader, partition table, boot_app0 and the application, 0xFF between them. It is
                              what esptool's merge_bin makes with `--flash_size keep`, without the tool.
  zenit-esp32c3-firmware.bin  the application alone, for an over-the-air update.
  THIRD_PARTY_NOTICES.txt     the notices, when --notices is given.
  SHA256SUMS                  the checksum of each file above.

It stops when the application does not fit its slot in partitions.csv, or does not carry the release version (a build
made with another ZENIT_VERSION).
"""

import argparse
import hashlib
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOARD = "esp32c3"
# Where the ESP32-C3 reads each part, from the chip's boot rules
BOOTLOADER_OFFSET = 0x0
PARTITION_TABLE_OFFSET = 0x8000
BOOT_APP0_OFFSET = 0xE000
DEFAULT_BOOT_APP0 = Path.home() / ".platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin"
FACTORY_NAME = f"zenit-{BOARD}-factory.bin"
FIRMWARE_NAME = f"zenit-{BOARD}-firmware.bin"
NOTICES_NAME = "THIRD_PARTY_NOTICES.txt"


class ReleaseError(Exception):
    pass


def app_slot(partitions_csv):
    """(offset, size) of the first application slot, `ota_0`, in a partitions.csv."""
    for line in partitions_csv.read_text(encoding="utf-8").splitlines():
        fields = [field.strip() for field in line.split("#", 1)[0].split(",")]
        if len(fields) >= 5 and fields[1] == "app" and fields[2] == "ota_0":
            return int(fields[3], 0), int(fields[4], 0)
    raise ReleaseError(f"{partitions_csv} has no ota_0 application slot")


def merge_factory(parts):
    """One image from (offset, bytes) parts: 0xFF where no part is. Parts must not overlap."""
    end = 0
    for offset, data in sorted(parts, key=lambda part: part[0]):
        if offset < end:
            raise ReleaseError(f"a part at {offset:#x} overlaps the one before it, which ends at {end:#x}")
        end = offset + len(data)
    image = bytearray(b"\xff" * end)
    for offset, data in parts:
        image[offset : offset + len(data)] = data
    return bytes(image)


def read(path, what):
    if not path.is_file():
        raise ReleaseError(f"{what} not found at {path} (pio run -e {BOARD})")
    return path.read_bytes()


def make_assets(version, build_dir, boot_app0, out_dir, partitions_csv, notices=None):
    """Writes the release files and returns their names."""
    if not re.fullmatch(r"[0-9A-Za-z][0-9A-Za-z.+-]{0,63}", version):
        raise ReleaseError(f"'{version}' is not a version")
    app = read(build_dir / "firmware.bin", "the application")
    offset, size = app_slot(partitions_csv)
    if len(app) > size:
        raise ReleaseError(f"the application is {len(app)} bytes, its slot {size}")
    # The version is a string in the application: a build with another one would publish the wrong number
    if version.encode("ascii") not in app:
        raise ReleaseError(f"the application does not carry the version {version}: build it with ZENIT_VERSION={version}")
    factory = merge_factory(
        [
            (BOOTLOADER_OFFSET, read(build_dir / "bootloader.bin", "the bootloader")),
            (PARTITION_TABLE_OFFSET, read(build_dir / "partitions.bin", "the partition table")),
            (BOOT_APP0_OFFSET, read(boot_app0, "boot_app0.bin")),
            (offset, app),
        ]
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / FACTORY_NAME).write_bytes(factory)
    (out_dir / FIRMWARE_NAME).write_bytes(app)
    names = [FACTORY_NAME, FIRMWARE_NAME]
    if notices is not None:
        shutil.copyfile(notices, out_dir / NOTICES_NAME)
        names.append(NOTICES_NAME)
    sums = "".join(f"{hashlib.sha256((out_dir / name).read_bytes()).hexdigest()}  {name}\n" for name in names)
    (out_dir / "SHA256SUMS").write_text(sums, encoding="utf-8")
    return names + ["SHA256SUMS"]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--notices", type=Path)
    parser.add_argument("--build-dir", type=Path, default=ROOT / ".pio" / "build" / BOARD)
    parser.add_argument("--boot-app0", type=Path, default=DEFAULT_BOOT_APP0)
    parser.add_argument("--partitions", type=Path, default=ROOT / "partitions.csv")
    args = parser.parse_args(argv)
    try:
        names = make_assets(args.version, args.build_dir, args.boot_app0, args.out, args.partitions, args.notices)
    except (ReleaseError, OSError) as error:
        sys.exit(f"release_assets: {error}")
    for name in names:
        print(f"{args.out / name}")


if __name__ == "__main__":
    main()
