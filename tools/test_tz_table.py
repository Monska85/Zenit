# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests of the time zone table of the web app: python3 -m unittest discover -s tools"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tz_table  # noqa: E402


def tzif(version, rule):
    """A TZif file cut down to what footer() reads: the magic, the version, some data, and the footer."""
    return b"TZif" + version + b"\0" * 40 + b"\n\x01\x02" + b"\n" + rule + b"\n"


class FooterTest(unittest.TestCase):
    def test_reads_the_rule_after_the_data(self):
        self.assertEqual(tz_table.footer(tzif(b"2", b"IST-5:30")), "IST-5:30")
        self.assertEqual(tz_table.footer(tzif(b"3", b"IST-2IDT,M3.4.4/26,M10.5.0")), "IST-2IDT,M3.4.4/26,M10.5.0")
        self.assertEqual(tz_table.footer(tzif(b"4", b"<-03>3")), "<-03>3")

    def test_refuses_what_the_board_cannot_take(self):
        for data in (
            b"TZjf2" + b"\n\nUTC0\n",  # not TZif
            tzif(b"\0", b"UTC0"),  # version 1 has no footer
            tzif(b"2", b""),  # an empty footer
            tzif(b"2", b"A" * 65),  # longer than the protocol's limit
            tzif(b"2", b"UTC 0"),  # a space
            tzif(b"2", b"UTC0")[:-1],  # no final newline
        ):
            with self.assertRaises(tz_table.TableError, msg=data):
                tz_table.footer(data)


class BuildTest(unittest.TestCase):
    """build() on a small fixture database, never the real one."""

    FILES = {
        "tzdata.zi": b"# version 2099z\nZ Europe/Rome 0:49:56 - LMT\nZ Europe/Berlin 0:53:28 - LMT\n"
        b"Z Etc/UTC 0 - UTC\nZ Asia/Kolkata 5:53:28 - LMT\nL Europe/Berlin Europe/Oslo\n"
        b"L Asia/Kolkata Asia/Calcutta\nL Etc/UTC UTC\n",
        "zone.tab": b"# comment\nIT\t+4154+01229\tEurope/Rome\nDE\t+5230+01322\tEurope/Berlin\n"
        b"NO\t+5955+01045\tEurope/Oslo\nIN\t+2232+08822\tAsia/Kolkata\n",
        "zone1970.tab": b"IT,SM,VA\t+4154+01229\tEurope/Rome\nDE,DK,NO,SE,SJ\t+5230+01322\tEurope/Berlin\n"
        b"IN\t+2232+08822\tAsia/Kolkata\n",
        "iso3166.tab": b"# comment\nDE\tGermany\nIN\tIndia\nIT\tItaly\nNO\tNorway\nFR\tFrance\n",
        "Europe/Rome": tzif(b"2", b"CET-1CEST,M3.5.0,M10.5.0/3"),
        "Europe/Berlin": tzif(b"2", b"CET-1CEST,M3.5.0,M10.5.0/3"),
        "Europe/Oslo": tzif(b"2", b"CET-1CEST,M3.5.0,M10.5.0/3"),
        "Etc/UTC": tzif(b"2", b"UTC0"),
        "Asia/Kolkata": tzif(b"2", b"IST-5:30"),
    }

    def test_lists_zones_aliases_and_countries(self):
        table = tz_table.build(self.FILES.__getitem__)
        self.assertEqual(table["tzdata"], "2099z")
        self.assertEqual(
            table["zones"],
            [
                # With a country, the most countries of zone1970.tab first, then by name; Etc/UTC last
                ["Europe/Berlin", "CET-1CEST,M3.5.0,M10.5.0/3", "DE"],
                ["Europe/Rome", "CET-1CEST,M3.5.0,M10.5.0/3", "IT"],
                ["Asia/Kolkata", "IST-5:30", "IN"],
                ["Europe/Oslo", "CET-1CEST,M3.5.0,M10.5.0/3", "NO"],
                ["Etc/UTC", "UTC0", ""],
            ],
        )
        # A link of zone.tab is a zone; every other link is an alias
        self.assertEqual(table["aliases"], {"Asia/Calcutta": "Asia/Kolkata", "UTC": "Etc/UTC"})
        # Only the countries the zones use
        self.assertEqual(table["countries"], {"DE": "Germany", "IN": "India", "IT": "Italy", "NO": "Norway"})

    def test_renders_json_one_entry_per_line(self):
        table = tz_table.build(self.FILES.__getitem__)
        text = tz_table.render(table)
        self.assertEqual(json.loads(text), table)
        self.assertIn('\n    ["Asia/Kolkata", "IST-5:30", "IN"],\n', text)
        self.assertIn('\n    "UTC": "Etc/UTC"\n', text)

    def test_refuses_an_alias_that_leads_nowhere(self):
        files = dict(self.FILES)
        files["tzdata.zi"] += b"L Asia/Nowhere Asia/Lost\n"
        with self.assertRaises(tz_table.TableError):
            tz_table.build(files.__getitem__)

    def test_refuses_a_country_without_a_name(self):
        files = dict(self.FILES)
        files["iso3166.tab"] = b"DE\tGermany\n"
        with self.assertRaises(tz_table.TableError):
            tz_table.build(files.__getitem__)

    def test_reads_the_pinned_version(self):
        self.assertEqual(tz_table.pinned_version("a==1\ntzdata==2026.6 \\\n    --hash=sha256:00\n"), "2026.6")
        with self.assertRaises(tz_table.TableError):
            tz_table.pinned_version("a==1\n")


class CommittedTableTest(unittest.TestCase):
    def test_the_committed_table_is_what_the_pinned_tzdata_makes(self):
        # Fails, with the reason, when tzdata is missing or not the pinned version: install requirements-ci.txt
        try:
            text = tz_table.installed()
        except tz_table.TableError as error:
            self.fail(str(error))
        self.assertTrue(
            tz_table.TABLE.read_text() == text,
            "web/src/device/zones.json is not what the pinned tzdata makes: run tools/tz_table.py write",
        )

    def test_the_committed_table_has_what_the_app_relies_on(self):
        table = json.loads(tz_table.TABLE.read_text())
        zones = {zone[0]: zone for zone in table["zones"]}
        self.assertEqual(zones["Etc/UTC"][1], "UTC0")
        self.assertEqual(zones["Asia/Kolkata"][1:], ["IST-5:30", "IN"])
        self.assertEqual(table["aliases"]["Asia/Calcutta"], "Asia/Kolkata")
        self.assertEqual(table["aliases"]["Europe/Kiev"], "Europe/Kyiv")
        for name, rule, country in table["zones"]:
            self.assertRegex(rule, tz_table.POSIX_TZ, name)
            self.assertTrue(country == "" or country in table["countries"], name)


if __name__ == "__main__":
    unittest.main()
