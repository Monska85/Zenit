# SPDX-License-Identifier: GPL-3.0-or-later
"""The web app as the image of the board's `www` partition (docs/board/wifi-and-updates-v1.md#web-image).

    tools/web_image.py --dist web/dist --version 1.2.3 --out zenit-web-1.2.3.bin

Gzips every file of the built web app, in a fixed order and without timestamps, and writes one image: a header with the
version, the protocol versions the app speaks (web/src/protocol/speaks.json) and the SHA-256 of the body, then an index
of the files (path, media type, offset, length) and their bytes. The output is the same for the same input. Fails when
the folder holds no index.html, which means the web app was not built, and when the app does not speak the protocol of
the firmware in the same checkout.

The firmware installer is left out: a page the board serves is plain http, where a browser gives no USB port, so that
page never loads it. Vite's build manifest (.vite/manifest.json) names the files only the installer uses; the build
fails when the manifest or the installer's entry is missing, so the installer is never embedded by mistake.

Standard library only.
"""

import argparse
import gzip
import hashlib
import json
import re
import struct
import sys
from pathlib import Path

TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".txt": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".webmanifest": "application/manifest+json",
}
# What a web app of ours does not need on a board: maps and anything else not served.
SKIPPED_SUFFIXES = (".map",)
# Vite's build manifest, which is not served either.
MANIFEST = ".vite/manifest.json"
# The module that loads the firmware installer (ESP Web Tools), as the build manifest names it.
INSTALLER_ENTRY = "src/ui/views/installer.tsx"
MAX_PATH = 127


class AssetsError(Exception):
    pass


def reachable(chunks, start, skip=()):
    """The files of the chunk `start` and of every chunk it imports, statically or on demand, except the chunks `skip`."""
    seen, files, todo = set(), set(), [start]
    while todo:
        key = todo.pop()
        if key in seen or key in skip:
            continue
        seen.add(key)
        chunk = chunks.get(key)
        if chunk is None:
            raise AssetsError(f"{MANIFEST}: no chunk '{key}'")
        files.add(chunk["file"])
        files.update(chunk.get("css", []))
        files.update(chunk.get("assets", []))
        todo += chunk.get("imports", []) + chunk.get("dynamicImports", [])
    return files


def installer_only(root):
    """The files that only the firmware installer uses, which the board does not serve."""
    path = root / MANIFEST
    if not path.is_file():
        raise AssetsError(f"{path} is missing: the web app must be built with its manifest (build.manifest)")
    chunks = json.loads(path.read_text(encoding="utf-8"))
    if INSTALLER_ENTRY not in chunks:
        raise AssetsError(f"{MANIFEST}: no '{INSTALLER_ENTRY}', so the installer cannot be left out")
    app = set()
    for key, chunk in chunks.items():
        if chunk.get("isEntry"):
            app |= reachable(chunks, key, skip=(INSTALLER_ENTRY,))
    return reachable(chunks, INSTALLER_ENTRY) - app


def collect(dist):
    """(path, media type, gzipped bytes, immutable) of each file, sorted by path."""
    root = Path(dist)
    if not (root / "index.html").is_file():
        raise AssetsError(f"{root}/index.html is missing: build the web app first (just web-build)")
    left_out = installer_only(root)
    files = []
    for path in sorted(p for p in root.rglob("*") if p.is_file() and not p.is_symlink()):
        relative = path.relative_to(root).as_posix()
        if relative.endswith(SKIPPED_SUFFIXES) or relative == MANIFEST or relative in left_out:
            continue
        # The board's rules (lib/ZenitNet/src/web_image.cpp): it refuses an image with any other path
        if len(relative) > MAX_PATH or ".." in relative or any(ord(c) < 0x21 or ord(c) > 0x7E or c == "\\" for c in relative):
            raise AssetsError(f"{relative}: the path is not one the board can serve")
        media = TYPES.get(path.suffix.lower())
        if media is None:
            raise AssetsError(f"{relative}: no media type for '{path.suffix}'")
        data = gzip.compress(path.read_bytes(), compresslevel=9, mtime=0)
        files.append((relative, media, data, relative.startswith("assets/")))
    return files


# The image's layout (lib/ZenitNet/src/web_image.h, docs/board/wifi-and-updates-v1.md#web-image).
MAGIC = b"ZWEB"
FORMAT = 1
HEADER_SIZE = 4096
PARTITION_SIZE = 0x80000
MAX_FILES = 64
MAX_MEDIA_TYPE = 63
VERSION_FIELD = 16
# X.Y.Z with at most six digits each, as the board's version rules
VERSION = re.compile(r"(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})")
# The protocol versions the app speaks: the app's client accepts the same range (web/src/protocol/client.ts).
RANGE_FILE = Path(__file__).resolve().parent.parent / "web" / "src" / "protocol" / "speaks.json"
# The web app's version.
PACKAGE = Path(__file__).resolve().parent.parent / "web" / "package.json"
# The protocol the firmware speaks (lib/ZenitProto/src/proto_limits.h).
PROTOCOL_HEADER = Path(__file__).resolve().parent.parent / "lib" / "ZenitProto" / "src" / "proto_limits.h"


def read_range(path=RANGE_FILE):
    """(protocol_min, protocol_max) from the app's range file."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    low, high = data.get("protocol_min"), data.get("protocol_max")
    if set(data) != {"protocol_min", "protocol_max"} or not all(
        isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 255 for v in (low, high)
    ):
        raise AssetsError(f"{path}: expected protocol_min and protocol_max, whole numbers from 1 to 255")
    if low > high:
        raise AssetsError(f"{path}: protocol_min is above protocol_max")
    return low, high


def firmware_protocol(path=PROTOCOL_HEADER):
    """The protocol version the firmware of this checkout speaks."""
    found = re.search(r"constexpr uint8_t PROTOCOL_VERSION = (\d+);", Path(path).read_text(encoding="utf-8"))
    if not found:
        raise AssetsError(f"{path}: no PROTOCOL_VERSION")
    return int(found.group(1))


def build_image(files, version, protocol_min, protocol_max):
    """The bytes of a web image: the header, then the index and the files."""
    if not VERSION.fullmatch(version) or len(version) > VERSION_FIELD:
        raise AssetsError(f"the version '{version}' is not X.Y.Z of at most {VERSION_FIELD} characters")
    if not 1 <= protocol_min <= protocol_max <= 255:
        raise AssetsError("the protocol range is not valid")
    if not 1 <= len(files) <= MAX_FILES:
        raise AssetsError(f"{len(files)} files: an image holds 1 to {MAX_FILES}")
    index_size = sum(1 + len(path) + 1 + 1 + len(media) + 1 + 8 for path, media, _, _ in files)
    index, data = bytearray(), bytearray()
    for path, media, content, _ in files:
        if len(media) > MAX_MEDIA_TYPE:
            raise AssetsError(f"{path}: the media type is too long")
        index += bytes([len(path)]) + path.encode("ascii") + b"\0"
        index += bytes([len(media)]) + media.encode("ascii") + b"\0"
        index += struct.pack("<II", index_size + len(data), len(content))
        data += content
    body = bytes(index + data)
    if HEADER_SIZE + len(body) > PARTITION_SIZE:
        raise AssetsError(f"the image is {HEADER_SIZE + len(body)} bytes: the partition holds {PARTITION_SIZE}")
    header = bytearray(HEADER_SIZE)
    header[0:4] = MAGIC
    header[4] = FORMAT
    header[5] = protocol_min
    header[6] = protocol_max
    header[8 : 8 + len(version)] = version.encode("ascii")
    struct.pack_into("<H", header, 24, len(files))
    struct.pack_into("<I", header, 28, len(body))
    header[32:64] = hashlib.sha256(body).digest()
    return bytes(header) + body


def read_header(image):
    """(version, protocol_min, protocol_max) of a web image, or AssetsError when its header breaks a rule."""
    if len(image) < HEADER_SIZE or image[0:4] != MAGIC or image[4] != FORMAT:
        raise AssetsError("not a web image")
    if image[7] or image[26:28] != b"\0\0" or any(image[64:HEADER_SIZE]):
        raise AssetsError("a reserved byte of the header is not zero")
    field = image[8 : 8 + VERSION_FIELD]
    text = field.rstrip(b"\0")
    if b"\0" in text:
        raise AssetsError("the version is not zero-padded")
    version = text.decode("ascii", "replace")
    if not VERSION.fullmatch(version):
        raise AssetsError(f"the version '{version}' is not X.Y.Z")
    low, high = image[5], image[6]
    if not 1 <= low <= high:
        raise AssetsError("the protocol range is not valid")
    return version, low, high


def read_image(image):
    """(version, protocol_min, protocol_max) of a whole web image checked with the board's rules
    (lib/ZenitNet/src/web_image.cpp): the header, the body's size and SHA-256, and every index entry. AssetsError
    otherwise."""
    version, low, high = read_header(image)
    count = struct.unpack_from("<H", image, 24)[0]
    body_size = struct.unpack_from("<I", image, 28)[0]
    if not 1 <= count <= MAX_FILES:
        raise AssetsError("the file count is out of range")
    # A published file is exactly the header and its body: the board installs only a download of that length
    if not 0 < body_size <= PARTITION_SIZE - HEADER_SIZE or len(image) != HEADER_SIZE + body_size:
        raise AssetsError("the image is not exactly its header and its body")
    body = image[HEADER_SIZE : HEADER_SIZE + body_size]
    if hashlib.sha256(body).digest() != image[32:64]:
        raise AssetsError("the body does not match its SHA-256")
    at, paths, starts = 0, set(), []
    for _ in range(count):
        texts = []
        for limit in (MAX_PATH, MAX_MEDIA_TYPE):
            if at >= len(body):
                raise AssetsError("the index is cut short")
            length = body[at]
            if at + 1 + length + 1 > len(body) or body[at + 1 + length] != 0:
                raise AssetsError("an index text is not terminated")
            text = body[at + 1 : at + 1 + length]
            if not 1 <= length <= limit or any(b < 0x20 or b > 0x7E for b in text):
                raise AssetsError("an index text is not valid")
            texts.append(text.decode("ascii"))
            at += 1 + length + 1
        path = texts[0]
        if path.startswith("/") or ".." in path or "\\" in path or " " in path:
            raise AssetsError(f"{path}: a path the board cannot serve")
        if path in paths:
            raise AssetsError(f"{path} is named twice")
        paths.add(path)
        if at + 8 > len(body):
            raise AssetsError("the index is cut short")
        offset, length = struct.unpack_from("<II", body, at)
        at += 8
        if offset > len(body) or length > len(body) - offset:
            raise AssetsError(f"{path} lies outside the body")
        starts.append(offset)
    if any(start < at for start in starts):
        raise AssetsError("a file overlaps the index")
    if "index.html" not in paths:
        raise AssetsError("index.html is missing")
    return version, low, high


def main(argv=None):
    parser = argparse.ArgumentParser(description="Write the built web app as the image of the board's www partition.")
    parser.add_argument("--dist", required=True, type=Path)
    parser.add_argument("--version", help="the web version, X.Y.Z (default: the version of web/package.json)")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--range", type=Path, default=RANGE_FILE, help="the app's protocol range file")
    parser.add_argument(
        "--protocol-header", type=Path, default=PROTOCOL_HEADER, help="refuse a range without this firmware's protocol"
    )
    args = parser.parse_args(argv)
    try:
        version = args.version or json.loads(PACKAGE.read_text(encoding="utf-8"))["version"]
        low, high = read_range(args.range)
        protocol = firmware_protocol(args.protocol_header)
        if not low <= protocol <= high:
            raise AssetsError(f"the app speaks protocols {low} to {high}, not the firmware's {protocol}")
        image = build_image(collect(args.dist), version, low, high)
    except AssetsError as error:
        print(f"web_image: {error}", file=sys.stderr)
        return 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(image)
    return 0


if __name__ == "__main__":
    sys.exit(main())
