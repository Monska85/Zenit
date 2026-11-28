#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""The table of IANA time zones the web app offers (docs/web/web-app-v1.md#board-settings).

    tools/tz_table.py write
        Make web/src/device/zones.json from the installed tzdata package, the version pinned in requirements-ci.txt.

    tools/tz_table.py check
        Fail unless the committed web/src/device/zones.json is what `write` makes. tools/test_tz_table.py runs it in
        `just check`, so a new tzdata version regenerates the table in the same change.

Each zone's POSIX TZ string is the footer of its TZif file (version 2 or later): the rule after the last transition,
which is what the board's C library reads. The tz database is in the public domain; only its data reaches the app.
"""

import argparse
import importlib.resources
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TABLE = ROOT / "web" / "src" / "device" / "zones.json"
LOCK = ROOT / "requirements-ci.txt"

# The protocol's limit of `timezone`: 1 to 64 printable ASCII characters other than space
POSIX_TZ = re.compile(r"[\x21-\x7e]{1,64}")


class TableError(Exception):
    pass


def footer(data, name="zone"):
    """The POSIX TZ string at the end of a TZif file: the text between its last two newlines."""
    if data[:4] != b"TZif":
        raise TableError(f"{name} is not a TZif file")
    if data[4:5] not in (b"2", b"3", b"4"):
        raise TableError(f"{name} is a TZif version 1 file, which has no footer")
    if not data.endswith(b"\n"):
        raise TableError(f"{name} does not end with its footer")
    parts = data.rsplit(b"\n", 2)
    if len(parts) != 3:
        raise TableError(f"{name} has no footer")
    text = parts[1].decode("ascii", errors="replace")
    if not POSIX_TZ.fullmatch(text):
        raise TableError(f"the footer of {name} is not a POSIX TZ string the board accepts: {text!r}")
    return text


def read_tab(text):
    """The rows of a .tab file of the tz database, without its comments."""
    return [line.split("\t") for line in text.splitlines() if line and not line.startswith("#")]


def pinned_version(lock_text):
    """The tzdata version pinned in requirements-ci.txt."""
    found = re.search(r"^tzdata==(\S+)", lock_text, re.MULTILINE)
    if not found:
        raise TableError("requirements-ci.txt pins no tzdata version")
    return found.group(1)


def build(read):
    """The table from the files of the tz database. `read(path)` returns the bytes of a file under zoneinfo/."""
    data = read("tzdata.zi").decode("utf-8")
    version = re.match(r"# version (\S+)", data)
    if not version:
        raise TableError("tzdata.zi names no version")
    canonical = [line.split()[1] for line in data.splitlines() if line.startswith("Z ")]
    links = {line.split()[2]: line.split()[1] for line in data.splitlines() if line.startswith("L ")}
    zone_tab = {row[2]: row[0] for row in read_tab(read("zone.tab").decode("utf-8"))}
    shared = {row[2]: len(row[0].split(",")) for row in read_tab(read("zone1970.tab").decode("utf-8"))}
    countries = {row[0]: row[1] for row in read_tab(read("iso3166.tab").decode("utf-8"))}

    names = sorted(set(canonical) | set(zone_tab))
    zones = [[name, footer(read(name), name), zone_tab.get(name, "")] for name in names]
    # Zones with a country first, then those shared by the most countries, then by name: the first zone of a POSIX
    # string is the one the app names a board's zone by when nothing else names it
    zones.sort(key=lambda zone: (zone[2] == "", -shared.get(zone[0], 0), zone[0]))
    listed = set(names)
    aliases = {}
    for alias, target in sorted(links.items()):
        if alias in listed:
            continue
        # A link to a link of zone.tab is not in tzdata.zi, but follow one anyway
        while target not in listed and target in links:
            target = links[target]
        if target not in listed:
            raise TableError(f"the alias {alias} leads to no zone")
        aliases[alias] = target
    used = sorted({zone[2] for zone in zones if zone[2]})
    missing = [code for code in used if code not in countries]
    if missing:
        raise TableError(f"iso3166.tab has no name for {', '.join(missing)}")
    return {
        "tzdata": version.group(1),
        "zones": zones,
        "aliases": aliases,
        "countries": {code: countries[code] for code in used},
    }


def render(table):
    """The JSON text of the table: one zone, alias or country per line, so a new tzdata version reads as a short diff."""
    lines = ["{"]
    lines.append(f'  "tzdata": {json.dumps(table["tzdata"])},')
    lines.append('  "zones": [')
    rows = [f"    {json.dumps(zone)}" for zone in table["zones"]]
    lines.append(",\n".join(rows))
    lines.append("  ],")
    for key in ("aliases", "countries"):
        lines.append(f'  "{key}": {{')
        rows = [f"    {json.dumps(name)}: {json.dumps(value)}" for name, value in table[key].items()]
        lines.append(",\n".join(rows))
        lines.append("  }" + ("," if key == "aliases" else ""))
    lines.append("}")
    return "\n".join(lines) + "\n"


def installed():
    """The table from the installed tzdata package, after checking it is the pinned version."""
    try:
        import tzdata
    except ImportError:
        raise TableError("the tzdata package is not installed: pip install --require-hashes -r requirements-ci.txt")
    want = pinned_version(LOCK.read_text())
    if tzdata.__version__ != want:
        raise TableError(f"tzdata {tzdata.__version__} is installed, requirements-ci.txt pins {want}")
    root = importlib.resources.files("tzdata").joinpath("zoneinfo")
    return render(build(lambda path: root.joinpath(*path.split("/")).read_bytes()))


def main(argv=None):
    parser = argparse.ArgumentParser(description="The table of IANA time zones the web app offers.")
    parser.add_argument("action", choices=["write", "check"])
    args = parser.parse_args(argv)
    try:
        text = installed()
    except TableError as error:
        print(f"tz_table: {error}", file=sys.stderr)
        return 1
    if args.action == "write":
        TABLE.write_text(text)
        print(f"wrote {TABLE.relative_to(ROOT)}")
        return 0
    if not TABLE.exists() or TABLE.read_text() != text:
        print(f"tz_table: {TABLE.relative_to(ROOT)} is not what the pinned tzdata makes: run tools/tz_table.py write",
              file=sys.stderr)
        return 1
    print(f"{TABLE.relative_to(ROOT)} matches the pinned tzdata")
    return 0


if __name__ == "__main__":
    sys.exit(main())
