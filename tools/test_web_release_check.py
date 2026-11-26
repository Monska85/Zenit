# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests of the web release preflight: python3 -m unittest discover -s tools"""

import contextlib
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import web_release_check as check  # noqa: E402

PROTOCOL = check.pages_site.assets.PROTOCOL_NAME


class WebReleaseCheckTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.firmware = self.root / "firmware"
        self.firmware.mkdir()

    def app_range(self, low, high):
        path = self.root / "speaks.json"
        path.write_text(json.dumps({"protocol_min": low, "protocol_max": high}), encoding="utf-8")
        return path

    def release(self, text, sums=True, listed=None):
        data = text.encode("ascii")
        (self.firmware / PROTOCOL).write_bytes(data)
        if sums:
            digest = hashlib.sha256(listed if listed is not None else data).hexdigest()
            (self.firmware / "SHA256SUMS").write_text(f"{digest}  {PROTOCOL}\n", encoding="utf-8")

    def header(self, protocol):
        path = self.root / "proto_limits.h"
        path.write_text(f"constexpr uint8_t PROTOCOL_VERSION = {protocol};\n", encoding="utf-8")
        return path

    def run_main(self, *args, command="check", stdin=""):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(out):
            status = check.main([command, *(str(arg) for arg in args)], stdin=io.StringIO(stdin))
        self.out = out.getvalue()
        return status, err.getvalue()

    def manifest(self, firmware="1.2.0", web="1.3.0"):
        path = self.root / "manifest.json"
        path.write_text(json.dumps({".": firmware, "web": web}), encoding="utf-8")
        return path

    def plan(self, tags, **versions):
        status, _ = self.run_main("--manifest", self.manifest(**versions), command="plan", stdin="\n".join(tags))
        self.assertEqual(status, 0)
        return self.out.strip()

    def latest(self, releases):
        status, _ = self.run_main(command="latest-firmware", stdin=json.dumps(releases))
        self.assertEqual(status, 0)
        return self.out.strip()

    def test_no_check_when_the_web_version_is_released_already(self):
        self.assertEqual(self.plan(["v1.2.0", "web-v1.3.0"]), "none")
        # The web tag decides alone: an untagged firmware version is the firmware release pull request's business
        self.assertEqual(self.plan(["v1.1.0", "web-v1.3.0"]), "none")

    def test_the_source_is_checked_when_the_same_run_releases_the_firmware(self):
        self.assertEqual(self.plan(["v1.1.0", "web-v1.2.0"]), "source")
        self.assertEqual(self.plan([]), "source")

    def test_the_published_firmware_is_checked_when_the_web_release_comes_alone(self):
        self.assertEqual(self.plan(["v1.2.0", "web-v1.2.0"]), "released")
        # Tags are compared whole: a longer version or another package's tag does not count
        self.assertEqual(self.plan(["v1.2.0", "web-v1.3.01", "web-v1.3.0-rc"]), "released")
        self.assertEqual(self.plan(["v1.2.01", "web-v1.2.0"]), "source")

    def test_a_manifest_without_both_versions_is_refused(self):
        path = self.root / "manifest.json"
        for text in ['{".": "1.0.0"}', '{"web": "1.0.0"}', "[]", "{"]:
            with self.subTest(text=text):
                path.write_text(text, encoding="utf-8")
                self.assertEqual(self.run_main("--manifest", path, command="plan")[0], 1)

    def test_the_latest_firmware_is_the_newest_published_version(self):
        def release(tag, draft=False, pre=False):
            return {"tagName": tag, "isDraft": draft, "isPrerelease": pre}

        self.assertEqual(self.latest([release("v1.9.0"), release("v1.10.0"), release("v1.2.0")]), "v1.10.0")
        # A draft (a release whose files are not attached yet) and a pre-release never pair with the app
        self.assertEqual(self.latest([release("v1.0.0"), release("v2.0.0", draft=True)]), "v1.0.0")
        self.assertEqual(self.latest([release("v1.0.0"), release("v2.0.0", pre=True)]), "v1.0.0")
        self.assertEqual(
            self.latest([release("v1.0.0"), release("web-v3.0.0"), release("v3.0.0-rc.1"), release("v03.0.0")]),
            "v1.0.0",
        )
        self.assertEqual(self.latest([release("web-v1.0.0")]), "")
        self.assertEqual(self.latest([]), "")

    def test_a_release_list_that_is_not_a_json_array_is_refused(self):
        for text in ["", "{}", "not json"]:
            with self.subTest(text=text):
                self.assertEqual(self.run_main(command="latest-firmware", stdin=text)[0], 1)

    def test_a_range_with_the_released_protocol_passes(self):
        self.release("1\n")
        self.assertEqual(self.run_main("--firmware", self.firmware, "--range", self.app_range(1, 2))[0], 0)

    def test_an_app_ahead_of_the_released_firmware_is_refused(self):
        # The source speaks protocol 2, the published firmware still 1: the app that speaks only 2 never reaches the site
        self.release("1\n")
        status, err = self.run_main("--firmware", self.firmware, "--range", self.app_range(2, 2))
        self.assertEqual(status, 1)
        self.assertIn("protocols 2 to 2", err)
        self.assertIn("protocol 1", err)

    def test_an_app_behind_the_released_firmware_is_refused(self):
        self.release("3\n")
        self.assertEqual(self.run_main("--firmware", self.firmware, "--range", self.app_range(1, 2))[0], 1)

    def test_the_firmware_source_is_checked_when_the_same_run_releases_it(self):
        self.assertEqual(self.run_main("--protocol-header", self.header(2), "--range", self.app_range(2, 2))[0], 0)
        self.assertEqual(self.run_main("--protocol-header", self.header(1), "--range", self.app_range(2, 2))[0], 1)

    def test_the_protocol_file_needs_its_checksum(self):
        self.release("1\n", sums=False)
        status, err = self.run_main("--firmware", self.firmware, "--range", self.app_range(1, 1))
        self.assertEqual(status, 1)
        self.assertIn("SHA256SUMS", err)
        self.release("1\n", listed=b"2\n")
        self.assertEqual(self.run_main("--firmware", self.firmware, "--range", self.app_range(1, 1))[0], 1)

    def test_a_bad_protocol_file_or_range_is_refused(self):
        for text in ["", "one\n", "0\n", "256\n"]:
            with self.subTest(text=text):
                self.release(text)
                self.assertEqual(self.run_main("--firmware", self.firmware, "--range", self.app_range(1, 255))[0], 1)
        self.release("1\n")
        self.assertEqual(self.run_main("--firmware", self.firmware, "--range", self.app_range(2, 1))[0], 1)
        self.assertEqual(self.run_main("--firmware", self.root / "missing", "--range", self.app_range(1, 1))[0], 1)

    def test_the_repository_app_speaks_the_firmware_source_protocol(self):
        self.assertEqual(self.run_main("--protocol-header", check.web_image.PROTOCOL_HEADER)[0], 0)


if __name__ == "__main__":
    unittest.main()
