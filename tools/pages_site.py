#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Assembles the GitHub Pages site: the latest web app at the root and the latest firmware under firmware/.

    tools/pages_site.py --web zenit-web-1.2.3.tar.gz --web-image zenit-web-1.2.3.bin --out site/
        [--firmware release/ --firmware-version 1.0.0]

--web is the archive a web release attaches (the built `web/dist`). --firmware is a folder with the files of a firmware
release (the bootloader, partition table, boot_app0 and firmware binaries, and `SHA256SUMS` when it has one: each is
checked against it) and --firmware-version its version, X.Y.Z. The site then holds the app, the four binaries under
`firmware/`, `firmware/manifest.json`, the manifest ESP Web Tools installs from, with each part at its own offset so
an update keeps the settings (docs/web/web-app-v1.md#installing-firmware), and `firmware/update.json`, the update
manifest a board on WiFi reads (docs/board/wifi-and-updates-v1.md#source): the version, the application's file name,
its size and SHA-256. Without
--firmware the site holds the app alone, which then says no firmware is published.

--web-image is the image of the board's `www` partition a web release attaches (tools/web_image.py). The site then also
holds it under `web/`, with `web/update.json`, the web manifest a board reads (docs/board/wifi-and-updates-v1.md#web-
updates): its version, file name, size, SHA-256 and protocol range. With a firmware too, the installer writes the image
at the `www` offset, so a board installed over USB has the app at once. `.nojekyll` is written so Pages serves the files
as they are.

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
import web_image

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


# The web image as the installer writes it, beside the firmware parts.
WEB_PART_NAME = "zenit-web.bin"


def www_offset(partitions_csv=assets.ROOT / "partitions.csv"):
    """The offset of the `www` partition in a partitions.csv."""
    for line in partitions_csv.read_text(encoding="utf-8").splitlines():
        fields = [field.strip() for field in line.split("#", 1)[0].split(",")]
        if fields[0] == "www":
            return int(fields[3], 0)
    raise SiteError("partitions.csv has no www partition")


def parts():
    """(file name, offset) of each firmware part the installer writes, in flash order."""
    app_offset = assets.app_slot(assets.ROOT / "partitions.csv")[0]
    return [
        (assets.BOOTLOADER_NAME, assets.BOOTLOADER_OFFSET),
        (assets.PARTITIONS_NAME, assets.PARTITION_TABLE_OFFSET),
        (assets.BOOT_APP0_NAME, assets.BOOT_APP0_OFFSET),
        (assets.FIRMWARE_NAME, app_offset),
    ]


def manifest(version, with_web=False):
    """The ESP Web Tools manifest of a firmware release: the parts at their offsets (with the web image at the `www`
    offset when `with_web`), and an offer to erase the whole flash for a clean install (without it, an install keeps
    the settings)."""
    listed = parts() + ([(WEB_PART_NAME, www_offset())] if with_web else [])
    return {
        "name": "Zenit",
        "version": version,
        "new_install_prompt_erase": True,
        "builds": [
            {
                "chipFamily": "ESP32-C3",
                "parts": [{"path": name, "offset": offset} for name, offset in listed],
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


def web_update_manifest(image):
    """The web manifest of a web image, as the board reads it: strict JSON with exactly these fields, in one line. The
    version and the protocol range are the image's own."""
    version, low, high = web_image.read_header(image)
    return json.dumps(
        {
            "schema": 1,
            "version": version,
            "file": f"zenit-web-{version}.bin",
            "size": len(image),
            "sha256": hashlib.sha256(image).hexdigest(),
            "protocol_min": low,
            "protocol_max": high,
        },
        separators=(",", ":"),
    )


def checked_web_image(path):
    """The bytes of a web image the board would install, or SiteError."""
    try:
        image = path.read_bytes()
        web_image.read_image(image)
    except (OSError, web_image.AssetsError) as error:
        raise SiteError(f"{path}: {error}") from error
    if not web_image.HEADER_SIZE < len(image) <= web_image.PARTITION_SIZE:
        raise SiteError(f"{path} is {len(image)} bytes: a board installs {web_image.HEADER_SIZE + 1} to "
                        f"{web_image.PARTITION_SIZE}")
    return image


def firmware_protocol(folder):
    """The protocol a firmware release speaks, from its protocol file (checked against SHA256SUMS)."""
    checked_sum(folder, assets.PROTOCOL_NAME)
    text = (folder / assets.PROTOCOL_NAME).read_text(encoding="ascii").strip()
    if not text.isdigit() or not 1 <= int(text) <= 255:
        raise SiteError(f"{assets.PROTOCOL_NAME} does not hold a protocol version")
    return int(text)


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


def assemble(web, out, firmware=None, firmware_version=None, web_image_path=None):
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
        image = checked_web_image(web_image_path) if web_image_path is not None else None
        if image is not None:
            (staging / "web").mkdir()
            update = web_update_manifest(image)
            if len(update) > MAX_UPDATE_MANIFEST:
                raise SiteError("the web manifest is longer than the board reads")
            (staging / "web" / json.loads(update)["file"]).write_bytes(image)
            (staging / "web" / "update.json").write_text(update + "\n", encoding="utf-8")
        if firmware is not None:
            target = staging / "firmware"
            target.mkdir()
            for name, _ in parts():
                checked_sum(firmware, name)
                shutil.copyfile(firmware / name, target / name)
            if image is not None:
                # The installer pairs this firmware with this app: the app must speak the firmware's protocol
                protocol = firmware_protocol(firmware)
                _, low, high = web_image.read_header(image)
                if not low <= protocol <= high:
                    raise SiteError(
                        f"the web app speaks protocols {low} to {high}, the firmware {firmware_version} protocol {protocol}"
                    )
                (target / WEB_PART_NAME).write_bytes(image)
            (target / "manifest.json").write_text(
                json.dumps(manifest(firmware_version, with_web=image is not None), indent=2) + "\n", encoding="utf-8"
            )
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
    parser.add_argument("--web-image", type=Path, help="the web image of that release (zenit-web-X.Y.Z.bin)")
    parser.add_argument("--firmware", type=Path, help="the folder with the files of a firmware release")
    parser.add_argument("--firmware-version", help="the version of that release, X.Y.Z")
    args = parser.parse_args(argv)
    try:
        assemble(args.web, args.out, args.firmware, args.firmware_version, args.web_image)
    except SiteError as error:
        print(f"pages_site: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
