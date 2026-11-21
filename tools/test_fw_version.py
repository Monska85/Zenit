# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests of tools/fw_version.py: python3 -m unittest discover -s tools"""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fw_version  # noqa: E402


class DescribeVersionTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ)
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop("ZENIT_VERSION", None)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = self.tmp.name

    def git(self, *args):
        env = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull)
        subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True, env=env)

    def init(self):
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "tag.gpgsign", "false")

    def commit(self, name):
        Path(self.root, name).write_text(name)
        self.git("add", name)
        self.git("commit", "-q", "-m", name)

    def short_head(self):
        return fw_version.git(self.root, "rev-parse", "--short", "HEAD")

    def test_override_wins_and_is_checked(self):
        os.environ["ZENIT_VERSION"] = "1.2.3"
        self.assertEqual(fw_version.describe_version(self.root), "1.2.3")
        os.environ["ZENIT_VERSION"] = "../x"
        with self.assertRaises(ValueError):
            fw_version.describe_version(self.root)

    def test_no_git(self):
        self.assertEqual(fw_version.describe_version(self.root), "0.0.0-unknown")

    def test_no_tag(self):
        self.init()
        self.commit("a")
        self.commit("b")
        self.assertEqual(fw_version.describe_version(self.root), f"0.0.0-dev.2+g{self.short_head()}")

    def test_exact_tag(self):
        self.init()
        self.commit("a")
        self.git("tag", "v1.2.0")
        self.assertEqual(fw_version.describe_version(self.root), "1.2.0")

    def test_after_tag_and_dirty(self):
        self.init()
        self.commit("a")
        self.git("tag", "v1.2.0")
        self.commit("b")
        sha = self.short_head()
        self.assertEqual(fw_version.describe_version(self.root), f"1.2.0-dev.1+g{sha}")
        Path(self.root, "b").write_text("changed")
        self.assertEqual(fw_version.describe_version(self.root), f"1.2.0-dev.1+g{sha}.dirty")

    def test_untracked_file_makes_it_dirty(self):
        self.init()
        self.commit("a")
        self.git("tag", "v1.2.0")
        Path(self.root, "new.cpp").write_text("int x;")
        self.assertEqual(fw_version.describe_version(self.root), f"1.2.0-dev.0+g{self.short_head()}.dirty")

    def test_ignored_file_keeps_it_clean(self):
        self.init()
        Path(self.root, ".gitignore").write_text("build/\n")
        self.git("add", ".gitignore")
        self.commit("a")
        self.git("tag", "v1.2.0")
        Path(self.root, "build").mkdir()
        Path(self.root, "build", "out.bin").write_text("x")
        self.assertEqual(fw_version.describe_version(self.root), "1.2.0")

    def test_suffixed_tags_do_not_count(self):
        self.init()
        self.commit("a")
        self.git("tag", "v1.0.0")
        self.commit("b")
        self.git("tag", "v2.0.0-rc1")
        self.assertEqual(fw_version.describe_version(self.root), f"1.0.0-dev.1+g{self.short_head()}")

    def test_highest_of_several_tags_on_one_commit(self):
        self.init()
        self.commit("a")
        self.git("tag", "v1.2.0")
        self.git("tag", "v1.10.0")
        self.assertEqual(fw_version.describe_version(self.root), "1.10.0")


if __name__ == "__main__":
    unittest.main()
