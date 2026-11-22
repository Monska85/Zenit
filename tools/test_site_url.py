# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests of the site address of a firmware build: python3 -m unittest discover -s tools"""

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import site_url  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


class SiteUrlTest(unittest.TestCase):
    def test_the_default_is_the_projects_site(self):
        self.assertEqual(site_url.site_url(None, "esp32c3"), "https://monska85.github.io/Zenit/")
        self.assertEqual(site_url.site_url("", "esp32c3"), site_url.DEFAULT)

    def test_the_default_is_the_one_the_firmware_headers_name(self):
        header = (ROOT / "include" / "site.h").read_text(encoding="utf-8")
        self.assertIn(f'"{site_url.DEFAULT}"', header)

    def test_a_release_build_takes_https_only(self):
        self.assertEqual(site_url.site_url("https://example.org/zenit/", "esp32c3"), "https://example.org/zenit/")
        self.assertEqual(site_url.site_url("https://example.org:8443/", "esp32c3"), "https://example.org:8443/")
        for bad in ("http://example.org/", "http://192.168.1.5:8000/"):
            with self.assertRaises(site_url.SiteUrlError, msg=bad):
                site_url.site_url(bad, "esp32c3")

    def test_the_test_build_takes_http_too(self):
        self.assertEqual(site_url.site_url("http://192.168.1.5:8000/", site_url.TEST_ENV), "http://192.168.1.5:8000/")
        self.assertEqual(site_url.site_url("https://example.org/", site_url.TEST_ENV), "https://example.org/")

    def test_what_is_not_an_address_is_refused(self):
        for bad in (
            "example.org/",
            "https://example.org",  # no final slash
            "https:///",
            "https://exa mple.org/",
            "https://example.org/a b/",
            "https://example.org/../",
            "https://example.org:0/",
            "https://example.org:99999/",
            "ftp://example.org/",
            'https://example.org/"x/',
            "https://example.org/\\x/",
            "https://example.org/?x=1/",
            "https://user@example.org/",
        ):
            with self.assertRaises(site_url.SiteUrlError, msg=bad):
                site_url.site_url(bad, site_url.TEST_ENV)

    def test_the_longest_address_the_board_can_build_with_is_accepted_and_one_more_is_not(self):
        base = "https://example.org/"
        longest = base + "a" * (site_url.MAX_SITE_URL - len(base) - 1) + "/"
        self.assertEqual(len(longest), site_url.MAX_SITE_URL)
        self.assertEqual(site_url.site_url(longest, "esp32c3"), longest)
        with self.assertRaises(site_url.SiteUrlError):
            site_url.site_url(longest[:-1] + "a/", "esp32c3")

    def test_the_longest_urls_fit_the_boards_buffers(self):
        header = (ROOT / "lib" / "ZenitUpdate" / "src" / "manifest.h").read_text(encoding="utf-8")
        max_url = int(re.search(r"MAX_URL = (\d+);", header).group(1))
        longest = "x" * site_url.MAX_SITE_URL
        self.assertLessEqual(len(longest + "firmware/" + "f" * 64), max_url)
        self.assertLessEqual(len(longest + "firmware/update.json"), max_url)

    def test_the_build_script_names_the_test_environment_the_ini_has(self):
        ini = (ROOT / "platformio.ini").read_text(encoding="utf-8")
        self.assertRegex(ini, rf"\[env:{re.escape(site_url.TEST_ENV)}\]")


if __name__ == "__main__":
    unittest.main()
