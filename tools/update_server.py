#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""A test server for the update flow: the update manifest and a firmware file over plain HTTP.

    python3 tools/update_server.py --version 1.2.0 --firmware .pio/build/esp32c3/firmware.bin [--port 8000]

Serves `/firmware/update.json` (made from the file: its size and SHA-256, as tools/pages_site.py writes it) and
`/firmware/zenit-esp32c3-firmware.bin`, on all interfaces so a board on the same network reaches it. Only the update
test firmware (`just build-update-test http://THIS-COMPUTER:PORT/`) reads from it: a release firmware accepts
https:// only. Stop it with Ctrl-C. Nothing else is served.

Standard library only.
"""

import argparse
import http.server
import sys
from pathlib import Path

import pages_site
import release_assets as assets


def handler_for(version, firmware_bytes):
    manifest = (pages_site.update_manifest(version, firmware_bytes) + "\n").encode("utf-8")
    routes = {
        "/firmware/update.json": ("application/json", manifest),
        "/firmware/" + assets.FIRMWARE_NAME: ("application/octet-stream", firmware_bytes),
    }

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - the name http.server calls
            route = routes.get(self.path.split("?", 1)[0])
            if route is None:
                self.send_response(404)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", route[0])
            self.send_header("Content-Length", str(len(route[1])))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(route[1])

    return Handler


def main(argv=None):
    parser = argparse.ArgumentParser(description="Serve a firmware file and its update manifest for tests.")
    parser.add_argument("--version", required=True, help="the version the manifest announces, X.Y.Z")
    parser.add_argument("--firmware", required=True, type=Path, help="the application file (firmware.bin)")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--bind", default="0.0.0.0", help="the address to listen on (default: all)")
    args = parser.parse_args(argv)
    if not pages_site.VERSION.fullmatch(args.version):
        print(f"update_server: the version '{args.version}' is not X.Y.Z", file=sys.stderr)
        return 1
    try:
        data = args.firmware.read_bytes()
    except OSError as error:
        print(f"update_server: {error}", file=sys.stderr)
        return 1
    if not pages_site.MIN_FIRMWARE_SIZE <= len(data) <= assets.app_slot(assets.ROOT / "partitions.csv")[1]:
        print("update_server: the file is not a size a board installs", file=sys.stderr)
        return 1
    server = http.server.ThreadingHTTPServer((args.bind, args.port), handler_for(args.version, data))
    print(f"serving version {args.version} ({len(data)} bytes) on http://{args.bind}:{server.server_address[1]}/firmware/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
