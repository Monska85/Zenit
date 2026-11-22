# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests of the release configuration: python3 -m unittest discover -s tools"""

import json
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fw_version  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "release-please-config.json").read_text(encoding="utf-8"))
MANIFEST = json.loads((ROOT / ".release-please-manifest.json").read_text(encoding="utf-8"))
# The types of AGENTS.md, Commits
COMMIT_TYPES = {"feat", "fix", "refactor", "perf", "docs", "test", "chore", "ci", "build", "style", "revert"}


class ReleasePleaseTest(unittest.TestCase):
    def test_a_package_for_the_firmware_with_plain_tags(self):
        self.assertEqual(list(CONFIG["packages"]), [".", "web"])
        package = CONFIG["packages"]["."]
        self.assertEqual(package["release-type"], "simple")
        # Tags are vX.Y.Z, the form fw_version.py counts as a release
        self.assertIs(package["include-component-in-tag"], False)
        self.assertEqual(fw_version.FIRMWARE_PREFIX, "v")
        self.assertEqual(package["changelog-path"], "CHANGELOG.md")

    def test_a_package_for_the_web_app_with_its_own_tags(self):
        package = CONFIG["packages"]["web"]
        self.assertEqual(package["release-type"], "node")
        # Tags are web-vX.Y.Z, which fw_version.py never counts as a firmware release (they do not start with `v`)
        self.assertEqual(package["component"], "web")
        self.assertIs(package["include-component-in-tag"], True)
        self.assertFalse("web-v1.0.0".startswith(fw_version.FIRMWARE_PREFIX))
        self.assertTrue((ROOT / "web" / package["changelog-path"]).is_file())
        # Each package has its own pull request, and the firmware package leaves the web app's files out
        self.assertIs(CONFIG["separate-pull-requests"], True)
        self.assertIn("web", CONFIG["packages"]["."]["exclude-paths"])

    def test_the_web_package_version_is_the_manifest_version(self):
        version = json.loads((ROOT / "web" / "package.json").read_text(encoding="utf-8"))["version"]
        self.assertEqual(version, MANIFEST["web"])
        lock = json.loads((ROOT / "web" / "package-lock.json").read_text(encoding="utf-8"))
        self.assertEqual(lock["version"], version)
        self.assertEqual(lock["packages"][""]["version"], version)

    def test_the_manifest_names_the_packages(self):
        self.assertEqual(list(MANIFEST), list(CONFIG["packages"]))
        for version in MANIFEST.values():
            self.assertRegex(version, r"^[0-9]+\.[0-9]+\.[0-9]+$")

    def test_every_commit_type_has_a_changelog_section(self):
        types = [section["type"] for section in CONFIG["changelog-sections"]]
        self.assertEqual(set(types), COMMIT_TYPES)
        self.assertEqual(len(types), len(set(types)))

    def test_sections_use_the_keep_a_changelog_names(self):
        visible = {s["section"] for s in CONFIG["changelog-sections"] if not s.get("hidden")}
        self.assertLessEqual(visible, {"Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"})
        self.assertTrue({"Added", "Fixed"} <= visible)

    def test_excluded_paths_exist(self):
        for path in CONFIG["packages"]["."]["exclude-paths"]:
            self.assertTrue((ROOT / path).exists(), path)

    def test_the_changelog_is_keep_a_changelog(self):
        text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertTrue(text.startswith("# Changelog\n"))
        self.assertIn("keepachangelog.com/en/1.1.0", text)
        self.assertIn("\n## [Unreleased]", text)


class WorkflowTest(unittest.TestCase):
    def workflows(self):
        return sorted((ROOT / ".github").rglob("*.yml"))

    def test_every_action_is_pinned_to_a_commit_with_its_version_in_a_comment(self):
        for path in self.workflows():
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                match = re.match(r"\s*(?:- )?uses:\s*(\S+)(.*)$", line)
                if not match or match.group(1).startswith("./"):
                    continue
                self.assertRegex(match.group(1), r"@[0-9a-f]{40}$", f"{path.name}:{number}")
                self.assertRegex(match.group(2), r"#\s*v[0-9]+\.[0-9]+\.[0-9]+", f"{path.name}:{number}")

    def test_the_release_workflow_builds_and_attaches_the_release_files(self):
        text = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
        self.assertIn("make release-assets", text)
        self.assertIn("googleapis/release-please-action@", text)
        self.assertIn("release-please-config.json", text)
        self.assertIn(".release-please-manifest.json", text)
        # The workflow attaches everything in release/, which is where the recipe writes
        self.assertIn('path: release/', text)
        self.assertIn('/release/*', text)

    def test_the_release_workflow_builds_the_web_app_and_deploys_pages_once_public(self):
        text = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
        self.assertIn("web--release_created", text)
        self.assertIn("web--tag_name", text)
        self.assertIn("zenit-web-", text)
        self.assertIn("tools/pages_site.py", text)
        self.assertIn("actions/deploy-pages@", text)
        # Pages on a private repository needs a paid plan: the deploy job runs only for a public one
        job = text[text.index("\n  pages:") :]
        self.assertIn("github.event.repository.visibility == 'public'", job.split("\n    steps:")[0])

    def test_the_ci_workflow_has_a_web_job_behind_the_changes_filter(self):
        text = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        job = text[text.index("\n  web:") :]
        self.assertIn("needs: changes", job)
        self.assertIn("needs.changes.outputs.code == 'true'", job)
        for step in ["web-test", "web-size", "web-e2e", "web-screenshots"]:
            self.assertIn(step, job)

    def test_the_release_recipe_exists_in_both_task_runners(self):
        self.assertIn("release-assets", (ROOT / "justfile").read_text(encoding="utf-8"))
        self.assertIn("\nrelease-assets:", (ROOT / "Makefile").read_text(encoding="utf-8"))

    def test_the_two_task_runners_have_the_same_recipes(self):
        text = (ROOT / "justfile").read_text(encoding="utf-8")
        just = set(re.findall(r"^([a-z][a-z0-9-]*)(?: [^:=\n]*)?:(?!=)", text, re.M))
        # A recipe marked [private] is a helper that make has as a file target instead
        just -= set(re.findall(r"^\[private\]\n([a-z][a-z0-9-]*)", text, re.M))
        make = set(re.findall(r"^([a-z][a-z0-9-]*):", (ROOT / "Makefile").read_text(encoding="utf-8"), re.M))
        just -= {"default"}
        make -= {"help"}
        self.assertEqual(just, make)


if __name__ == "__main__":
    unittest.main()
