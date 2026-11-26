#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Checks, before a web release is created, that the web app speaks the protocol of the firmware the site will pair it
with (tools/pages_site.py refuses the pairing when the site is assembled, but by then the release exists).

    git tag --list | tools/web_release_check.py plan
    gh release list --json tagName,isDraft,isPrerelease | tools/web_release_check.py latest-firmware
    tools/web_release_check.py check --firmware DIR        the files of the latest published firmware release
    tools/web_release_check.py check --protocol-header H   the firmware source, when the same run releases the firmware

`plan` reads the tags on standard input and the versions of .release-please-manifest.json (--manifest), and prints what
to check: `none` when the web version is tagged already (this commit creates no web release), `source` when the
firmware version is not tagged either (the same run releases the firmware, so the site pairs the app with the firmware
of this source), `released` otherwise (the site pairs it with the latest published firmware release).

`latest-firmware` reads a `gh release list` JSON array on standard input and prints the tag of the newest published
firmware release (vX.Y.Z, by version; drafts and pre-releases do not count), or nothing when there is none.

`check` exits 1, with the reason, when the app's range (web/src/protocol/speaks.json, --range for another file) does
not include the firmware's protocol or a file breaks a rule. DIR holds the release's `zenit-esp32c3-protocol.txt` and
its `SHA256SUMS`, which must list it.

Standard library only.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import pages_site
import web_image

MANIFEST = Path(__file__).resolve().parent.parent / ".release-please-manifest.json"
FIRMWARE_TAG = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")


class CheckError(Exception):
    pass


def plan(manifest, tags):
    """`none`, `source` or `released`: what the web release of this commit is checked against."""
    try:
        versions = json.loads(Path(manifest).read_text(encoding="utf-8"))
        web, firmware = versions["web"], versions["."]
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise CheckError(f"{manifest}: no web and firmware versions ({error})") from error
    tags = set(tags)
    if f"web-v{web}" in tags:
        return "none"
    if f"v{firmware}" not in tags:
        return "source"
    return "released"


def latest_firmware(releases):
    """The tag of the newest published firmware release, or None."""
    if not isinstance(releases, list):
        raise CheckError("the release list is not a JSON array")
    found = []
    for release in releases:
        if not isinstance(release, dict) or release.get("isDraft") is not False:
            continue
        if release.get("isPrerelease") is not False:
            continue
        match = FIRMWARE_TAG.fullmatch(str(release.get("tagName", "")))
        if match:
            found.append((tuple(int(part) for part in match.groups()), release["tagName"]))
    return max(found)[1] if found else None


def released_protocol(folder):
    """The protocol of a published firmware release, from its protocol file checked against its SHA256SUMS."""
    if not (folder / "SHA256SUMS").is_file():
        raise CheckError(f"{folder / 'SHA256SUMS'} is missing")
    try:
        return pages_site.firmware_protocol(folder)
    except (OSError, UnicodeDecodeError, pages_site.SiteError) as error:
        raise CheckError(str(error)) from error


def check(range_path, protocol):
    """Raises CheckError when the app's range does not include `protocol`."""
    try:
        low, high = web_image.read_range(range_path)
    except (OSError, ValueError, web_image.AssetsError) as error:
        raise CheckError(str(error)) from error
    if not low <= protocol <= high:
        raise CheckError(f"the web app speaks protocols {low} to {high}, the firmware protocol {protocol}")
    return low, high


def main(argv=None, stdin=None):
    parser = argparse.ArgumentParser(description="Check the web app's protocol range against the released firmware.")
    commands = parser.add_subparsers(dest="command", required=True)
    plan_parser = commands.add_parser("plan", help="what to check, from the tags on standard input")
    plan_parser.add_argument("--manifest", type=Path, default=MANIFEST, help="the release-please manifest")
    commands.add_parser("latest-firmware", help="the newest published firmware tag, from gh release list JSON")
    check_parser = commands.add_parser("check", help="check the app's range against a firmware's protocol")
    source = check_parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--firmware", type=Path, help="the folder with the protocol file and SHA256SUMS of a release")
    source.add_argument("--protocol-header", type=Path, help="the firmware source's proto_limits.h")
    check_parser.add_argument("--range", type=Path, default=web_image.RANGE_FILE, help="the app's protocol range file")
    args = parser.parse_args(argv)
    stdin = sys.stdin if stdin is None else stdin
    try:
        if args.command == "plan":
            print(plan(args.manifest, stdin.read().split()))
        elif args.command == "latest-firmware":
            try:
                releases = json.loads(stdin.read())
            except ValueError as error:
                raise CheckError(f"the release list is not JSON ({error})") from error
            print(latest_firmware(releases) or "")
        else:
            if args.firmware is not None:
                protocol = released_protocol(args.firmware)
            else:
                try:
                    protocol = web_image.firmware_protocol(args.protocol_header)
                except (OSError, web_image.AssetsError) as error:
                    raise CheckError(str(error)) from error
            low, high = check(args.range, protocol)
            print(f"web_release_check: the web app speaks protocols {low} to {high}, the firmware protocol {protocol}")
    except CheckError as error:
        print(f"web_release_check: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
