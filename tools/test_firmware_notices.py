# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests of tools/firmware_notices.py: python3 -m unittest discover -s tools"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import firmware_notices as notices  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

CONFIG = {
    "pins": {"esp-idf": "v1.0.0", "arduino": "3.0.0", "components": {"vendor__part": "2.0"}},
    "sections": [
        {
            "name": "Core",
            "version": "arduino",
            "license": "LGPL",
            "source": "https://example.org/core/{version}",
            "files": ["core.txt"],
            "archives": ["libCore.a"],
        },
        {
            "name": "IDF",
            "version": "esp-idf",
            "license": "Apache-2.0",
            "source": "https://example.org/idf/{version}",
            "files": ["idf.txt"],
            "archives": ["libidf.a", "libshared.a"],
        },
        {
            "name": "Shared",
            "version": "esp-idf",
            "license": "Apache-2.0",
            "source": "https://example.org/shared",
            "files": ["idf.txt"],
            "archives": ["libshared.a"],
        },
        {
            "name": "Part",
            "version": "component:vendor__part",
            "license": "MIT",
            "source": "https://example.org/part/{version}",
            "files": ["part.txt"],
            "archives": ["libvendor__part.a"],
        },
        {
            "name": "C library",
            "version": "toolchain",
            "license": "BSD",
            "source": "https://example.org/libc",
            "files": ["toolchain:share/licenses/libc/COPYING"],
            "archives": ["libc.a"],
        },
    ],
    "libraries": {"Json": {"license": "MIT", "files": ["LICENSE.txt"]}},
}

MAP = """
Archive member included to satisfy reference by file (symbol)

{libs}/lib/libidf.a(a.o)             {build}/main.o (a)
{libs}/lib/libshared.a(b.o)          {libs}/lib/libidf.a(a.o) (b)
{libs}/ld/libvendor__part.a(c.o)     {build}/main.o (c)
{tool}/bin/../lib/libc.a(d.o)        {build}/main.o (d)
{build}/libCore.a(e.o)               {build}/main.o (e)
{build}/lib1/libProto.a(f.o)         {build}/main.o (f)
{build}/lib2/libOwn.a(g.o)           {build}/main.o (g)

Discarded input sections

 .text          0x0000 {libs}/lib/libignored.a(x.o)

Memory Configuration
"""


class FixtureTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        packages = self.root / "home" / "packages"
        self.libs = packages / "framework-arduinoespressif32-esp32c3-libs"
        self.tool = packages / "toolchain-test"
        self.libs.mkdir(parents=True)
        (self.tool / "share" / "licenses" / "libc").mkdir(parents=True)
        self.write(self.libs / "versions.txt", "lib-builder: master abc\nesp-idf: v1.0.0 deadbeef\nvendor__part: 2.0\n")
        self.write(self.libs / "package.json", json.dumps({"version": "3.0.0"}))
        self.write(self.tool / "package.json", json.dumps({"version": "9.9.9"}))
        self.write(self.tool / "share" / "licenses" / "libc" / "COPYING", "LIBC LICENSE TEXT")
        self.licenses = self.root / "LICENSES"
        for name, text in {"core.txt": "CORE TEXT", "idf.txt": "IDF TEXT", "part.txt": "PART TEXT"}.items():
            self.write(self.licenses / "firmware" / name, text)
        self.config_path = self.licenses / "firmware.json"
        self.write(self.config_path, json.dumps(CONFIG))
        # The project's libraries and the downloaded ones
        self.write(
            self.root / "lib" / "Proto" / "library.json",
            json.dumps({"name": "Proto", "dependencies": {"vendor/Json": "1.0.0", "Own": "*"}}),
        )
        self.write(self.root / "lib" / "Own" / "library.json", json.dumps({"name": "Own"}))
        self.libdeps = self.root / "libdeps"
        self.write(self.libdeps / "esp32c3" / "Json" / "LICENSE.txt", "JSON LICENSE TEXT")
        self.write(
            self.libdeps / "esp32c3" / "Json" / "library.json",
            json.dumps({"version": "7.0.0", "repository": {"url": "https://example.org/json.git"}}),
        )
        self.build = self.root / "build"

    @staticmethod
    def write(path, text):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def write_map(self, text=MAP):
        self.write(
            self.build / "esp32c3" / "firmware.map",
            text.format(libs=self.libs, tool=self.tool, build=self.build / "esp32c3"),
        )

    def run_notices(self, version="1.2.3"):
        return notices.build_notices(
            version,
            "https://example.org/source",
            build_dir=self.build,
            libdeps_dir=self.libdeps,
            config_path=self.config_path,
            root=self.root,
        )


class LinkMapTest(unittest.TestCase):
    def test_linked_archives_reads_only_the_included_members(self):
        text = MAP.format(libs="/p/packages/fw-libs", tool="/p/packages/tc", build="/b")
        self.assertEqual(
            notices.linked_archives(text),
            [
                "/b/lib1/libProto.a",
                "/b/lib2/libOwn.a",
                "/b/libCore.a",
                "/p/packages/fw-libs/ld/libvendor__part.a",
                "/p/packages/fw-libs/lib/libidf.a",
                "/p/packages/fw-libs/lib/libshared.a",
                "/p/packages/tc/bin/../lib/libc.a",
            ],
        )

    def test_a_map_without_the_list_is_an_error(self):
        with self.assertRaises(notices.NoticesError):
            notices.linked_archives("Memory Configuration\n")

    def test_package_root(self):
        self.assertEqual(notices.package_root("/h/packages/fw-libs/lib/libx.a"), Path("/h/packages/fw-libs"))
        self.assertEqual(notices.package_root("/h/packages/tc/bin/../lib/libc.a"), Path("/h/packages/tc"))
        self.assertIsNone(notices.package_root("/proj/.pio/build/esp32c3/libFrameworkArduino.a"))


class BuildNoticesTest(FixtureTest):
    def test_the_notices_list_what_the_build_links_with_numbered_license_texts(self):
        self.write_map()
        text = self.run_notices()
        self.assertTrue(text.startswith("Zenit firmware 1.2.3: third-party notices"))
        self.assertIn("https://example.org/source", text)
        for name in ("Core", "IDF", "Shared", "Part", "C library", "Json"):
            self.assertRegex(text, rf"\d+\. {name}\n")
        self.assertIn("   Version: 3.0.0\n   License: LGPL\n   Source: https://example.org/core/3.0.0", text)
        self.assertIn("   Version: v1.0.0\n   License: Apache-2.0\n   Source: https://example.org/idf/v1.0.0", text)
        self.assertIn("   Version: 2.0\n   License: MIT\n   Source: https://example.org/part/2.0", text)
        self.assertIn("   Version: 9.9.9\n   License: BSD", text)
        self.assertIn("   Version: 7.0.0\n   License: MIT\n   Source: https://example.org/json", text)
        for body in ("CORE TEXT", "IDF TEXT", "PART TEXT", "LIBC LICENSE TEXT", "JSON LICENSE TEXT"):
            self.assertEqual(text.count(body), 1, body)

    def test_a_text_shared_by_sections_is_printed_once_with_one_number(self):
        self.write_map()
        text = self.run_notices()
        self.assertEqual(text.count("IDF TEXT"), 1)
        self.assertEqual(text.count("   License text: [2]\n"), 2)

    def test_an_archive_no_section_names_fails(self):
        self.write_map(MAP.replace("{build}/libCore.a(e.o)", "{libs}/lib/libnew.a(e.o)"))
        with self.assertRaisesRegex(notices.NoticesError, "libnew.a"):
            self.run_notices()

    def test_a_framework_version_other_than_the_pin_fails(self):
        self.write_map()
        self.write(self.libs / "versions.txt", "esp-idf: v1.1.0 deadbeef\nvendor__part: 2.0\n")
        with self.assertRaisesRegex(notices.NoticesError, "esp-idf v1.1.0.*v1.0.0"):
            self.run_notices()

    def test_a_component_version_other_than_the_pin_fails(self):
        self.write_map()
        self.write(self.libs / "versions.txt", "esp-idf: v1.0.0 deadbeef\nvendor__part: 2.1\n")
        with self.assertRaisesRegex(notices.NoticesError, "vendor__part 2.1"):
            self.run_notices()

    def test_an_arduino_version_other_than_the_pin_fails(self):
        self.write_map()
        self.write(self.libs / "package.json", json.dumps({"version": "3.0.1"}))
        with self.assertRaisesRegex(notices.NoticesError, "arduino 3.0.1"):
            self.run_notices()

    def test_a_missing_link_map_fails(self):
        with self.assertRaisesRegex(notices.NoticesError, "firmware.map not found"):
            self.run_notices()

    def test_a_missing_license_text_fails(self):
        self.write_map()
        (self.licenses / "firmware" / "part.txt").unlink()
        with self.assertRaisesRegex(notices.NoticesError, "part.txt not found"):
            self.run_notices()

    def test_a_missing_package_fails(self):
        self.write_map("Archive member included\n{build}/libCore.a(e.o)   x\n\nMemory Configuration\n")
        with self.assertRaisesRegex(notices.NoticesError, "no framework library package"):
            self.run_notices()

    def test_a_library_the_configuration_does_not_name_fails(self):
        self.write_map()
        config = dict(CONFIG, libraries={})
        self.write(self.config_path, json.dumps(config))
        with self.assertRaisesRegex(notices.NoticesError, "Json is linked"):
            self.run_notices()

    def test_a_header_only_library_is_listed_only_when_a_linked_project_library_needs_it(self):
        self.write_map(MAP.replace("{build}/lib1/libProto.a(f.o)         {build}/main.o (f)\n", ""))
        text = self.run_notices()
        self.assertNotIn("JSON LICENSE TEXT", text)

    def test_a_library_that_was_not_downloaded_fails(self):
        self.write_map()
        for path in sorted((self.libdeps / "esp32c3" / "Json").iterdir()):
            path.unlink()
        (self.libdeps / "esp32c3" / "Json").rmdir()
        with self.assertRaisesRegex(notices.NoticesError, "build the firmware first"):
            self.run_notices()

    def test_main_writes_the_file_and_reports_errors(self):
        out = self.root / "notices.txt"
        with self.assertRaises(SystemExit) as raised:
            notices.main(["--version", "1", "--out", str(out), "--build-dir", str(self.build / "missing")])
        self.assertIn("firmware_notices:", str(raised.exception))
        self.assertFalse(out.exists())


class RepositoryConfigurationTest(unittest.TestCase):
    """The real configuration and the license texts that ship with it."""

    def setUp(self):
        self.config = json.loads((ROOT / "LICENSES" / "firmware.json").read_text(encoding="utf-8"))

    def test_every_named_license_file_exists_and_is_not_empty(self):
        for section in self.config["sections"]:
            for file in section["files"]:
                if file.startswith("toolchain:"):
                    continue
                path = ROOT / "LICENSES" / "firmware" / file
                self.assertTrue(path.is_file() and path.stat().st_size > 0, f"{section['name']}: {file}")

    def test_every_section_has_what_the_tool_reads(self):
        kinds = ("esp-idf", "arduino", "toolchain")
        for section in self.config["sections"]:
            for key in ("name", "version", "license", "source", "files", "archives"):
                self.assertIn(key, section, section.get("name"))
            self.assertTrue(section["version"] in kinds or section["version"].startswith("component:"), section["name"])
            self.assertTrue(section["files"] and section["archives"], section["name"])

    def test_component_versions_have_a_pin(self):
        for section in self.config["sections"]:
            if section["version"].startswith("component:"):
                self.assertIn(section["version"].split(":", 1)[1], self.config["pins"]["components"])

    def test_the_json_library_version_matches_the_one_the_firmware_pins(self):
        library = json.loads((ROOT / "lib" / "ZenitProto" / "library.json").read_text(encoding="utf-8"))
        self.assertEqual(library["dependencies"]["bblanchon/ArduinoJson"], "7.4.3")
        self.assertIn("ArduinoJson", self.config["libraries"])


if __name__ == "__main__":
    unittest.main()
