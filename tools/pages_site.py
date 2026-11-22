#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Assembles the GitHub Pages site: the latest web app at the root and the latest firmware under firmware/.

    tools/pages_site.py --web zenit-web-1.2.3.tar.gz --out site/ [--firmware release/ --firmware-version 1.0.0]

--web is the archive a web release attaches (the built `web/dist`). --firmware is a folder with the files of a firmware
release (the bootloader, partition table, boot_app0 and firmware binaries, and `SHA256SUMS` when it has one: each is
checked against it) and --firmware-version its version, X.Y.Z. The site then holds the app, the four binaries under
`firmware/`, `firmware/manifest.json`, the manifest ESP Web Tools installs from, with each part at its own offset so
an update keeps the settings (docs/web/web-app-v1.md#installing-firmware), and `firmware/update.json`, the update
manifest a board on WiFi reads (docs/board/wifi-and-updates-v1.md#source): the version, the application's file name,
its size and SHA-256. Without
--firmware the site holds the app alone, which then says no firmware is published. `.nojekyll` is written so Pages
serves the files as they are.

Standard library only.
"""

import argparse
import hashlib
import json
import re
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path

import release_assets as assets

# The parts of the factory image that the installer writes, each at its own offset: the file names and offsets are those
# of tools/release_assets.py and partitions.csv. The settings memory (0x9000 to 0xDFFF) is not among them, so an update
# keeps the settings.
# The longest manifest the board reads (lib/ZenitUpdate/src/manifest.h)
MAX_UPDATE_MANIFEST = 1024
# The smallest application a board installs (lib/ZenitUpdate/src/manifest.h)
MIN_FIRMWARE_SIZE = 65536
VERSION = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")


class SiteError(Exception):
    pass


def parts():
    """(file name, offset) of each part the installer writes, in flash order."""
    app_offset = assets.app_slot(assets.ROOT / "partitions.csv")[0]
    return [
        (assets.BOOTLOADER_NAME, assets.BOOTLOADER_OFFSET),
        (assets.PARTITIONS_NAME, assets.PARTITION_TABLE_OFFSET),
        (assets.BOOT_APP0_NAME, assets.BOOT_APP0_OFFSET),
        (assets.FIRMWARE_NAME, app_offset),
    ]


def manifest(version):
    """The ESP Web Tools manifest of a firmware release: the parts at their offsets, and an offer to erase the whole
    flash for a clean install (without it, an install keeps the settings)."""
    return {
        "name": "Zenit",
        "version": version,
        "new_install_prompt_erase": True,
        "builds": [
            {
                "chipFamily": "ESP32-C3",
                "parts": [{"path": name, "offset": offset} for name, offset in parts()],
            }
        ],
    }


def update_manifest(version, firmware_bytes):
    """The update manifest of a firmware release, as the board reads it: strict JSON with exactly these fields, in one
    line of at most 1,024 bytes. The size and the hash are those of the application file the site serves."""
    return json.dumps(
        {
            "schema": 1,
            "board": "esp32c3",
            "version": version,
            "file": assets.FIRMWARE_NAME,
            "size": len(firmware_bytes),
            "sha256": hashlib.sha256(firmware_bytes).hexdigest(),
        },
        separators=(",", ":"),
    )


def extract_web(archive, out):
    """Unpacks the web archive into `out`. The `data` filter refuses absolute paths, paths that leave the folder,
    links and device files, so a hostile archive cannot write elsewhere."""
    try:
        with tarfile.open(archive, "r:gz") as tar:
            tar.extractall(out, filter="data")
    except (tarfile.TarError, OSError) as error:
        raise SiteError(f"cannot unpack {archive}: {error}")
    if not (out / "index.html").is_file():
        raise SiteError(f"{archive} holds no index.html at its root: it is not a built web app")


def checked_sum(folder, name):
    """The SHA-256 of folder/name, compared with folder/SHA256SUMS when that file exists."""
    path = folder / name
    if not path.is_file():
        raise SiteError(f"{path} is missing")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    sums = folder / "SHA256SUMS"
    if sums.is_file():
        listed = {}
        for line in sums.read_text(encoding="utf-8").splitlines():
            parts = line.split()
            if len(parts) == 2:
                listed[parts[1].lstrip("*")] = parts[0]
        if listed.get(name) != digest:
            raise SiteError(f"{name} does not match {sums}")
    return digest


def assemble(web, out, firmware=None, firmware_version=None):
    if (firmware is None) != (firmware_version is None):
        raise SiteError("--firmware and --firmware-version go together")
    if firmware_version is not None and not VERSION.fullmatch(firmware_version):
        raise SiteError(f"the firmware version '{firmware_version}' is not X.Y.Z")
    if out.exists() and any(out.iterdir()):
        raise SiteError(f"{out} is not empty")
    # Built beside the target and moved in whole, so a failure leaves no half-made site
    staging = Path(tempfile.mkdtemp(prefix="zenit-site-"))
    try:
        extract_web(web, staging)
        if firmware is not None:
            target = staging / "firmware"
            target.mkdir()
            for name, _ in parts():
                checked_sum(firmware, name)
                shutil.copyfile(firmware / name, target / name)
            (target / "manifest.json").write_text(json.dumps(manifest(firmware_version), indent=2) + "\n", encoding="utf-8")
            firmware_bytes = (target / assets.FIRMWARE_NAME).read_bytes()
            slot_size = assets.app_slot(assets.ROOT / "partitions.csv")[1]
            if not MIN_FIRMWARE_SIZE <= len(firmware_bytes) <= slot_size:
                raise SiteError(
                    f"{assets.FIRMWARE_NAME} is {len(firmware_bytes)} bytes: a board updates only to a file of "
                    f"{MIN_FIRMWARE_SIZE} to {slot_size} bytes"
                )
            update = update_manifest(firmware_version, firmware_bytes)
            if len(update) > MAX_UPDATE_MANIFEST:
                raise SiteError("the update manifest is longer than the board reads")
            (target / "update.json").write_text(update + "\n", encoding="utf-8")
        (staging / ".nojekyll").write_text("", encoding="utf-8")
        out.mkdir(parents=True, exist_ok=True)
        for item in staging.iterdir():
            shutil.move(str(item), out / item.name)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Assemble the GitHub Pages site of the web app and the firmware.")
    parser.add_argument("--web", required=True, type=Path, help="the archive of a web release (zenit-web-X.Y.Z.tar.gz)")
    parser.add_argument("--out", required=True, type=Path, help="the folder to write the site into (empty or missing)")
    parser.add_argument("--firmware", type=Path, help="the folder with the files of a firmware release")
    parser.add_argument("--firmware-version", help="the version of that release, X.Y.Z")
    args = parser.parse_args(argv)
    try:
        assemble(args.web, args.out, args.firmware, args.firmware_version)
    except SiteError as error:
        print(f"pages_site: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
