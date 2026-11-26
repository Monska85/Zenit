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

    def test_releases_are_drafts_with_their_tags_until_their_files_are_attached(self):
        # The release workflow publishes a release after attaching its files; the tag exists at once, so release-please
        # finds the previous release while the draft waits
        self.assertIs(CONFIG["draft"], True)
        self.assertIs(CONFIG["force-tag-creation"], True)

    def test_the_changelog_is_keep_a_changelog(self):
        text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertTrue(text.startswith("# Changelog\n"))
        self.assertIn("keepachangelog.com/en/1.1.0", text)
        self.assertIn("\n## [Unreleased]", text)


def read(*parts):
    return ROOT.joinpath(*parts).read_text(encoding="utf-8")


def job(text, name):
    """The text of one job of a workflow, up to the next job."""
    start = text.index(f"\n  {name}:\n")
    following = re.search(r"\n  [a-z][a-z0-9-]*:\n", text[start + 1 :])
    return text[start : start + 1 + following.start()] if following else text[start:]


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

    def test_the_release_runs_only_after_ci_passes_on_a_push_to_main(self):
        text = read(".github", "workflows", "release.yml")
        self.assertRegex(read(".github", "workflows", "ci.yml"), r"^name: CI\n")
        trigger = text[text.index("\non:\n") : text.index("\npermissions:")]
        self.assertIn("  workflow_run:\n    workflows: [CI]\n    types: [completed]\n    branches: [main]\n", trigger)
        self.assertNotIn("  push:", trigger)
        # CI runs make check and the web gate; the release does not run them again
        self.assertNotIn("make check", text)
        self.assertNotIn("\n  check:", text)
        gate = job(text, "preflight").split("\n    steps:")[0]
        for condition in [
            "github.event_name == 'workflow_run'",
            "github.event.workflow_run.conclusion == 'success'",
            "github.event.workflow_run.event == 'push'",
            "github.event.workflow_run.head_branch == 'main'",
            # A pull request from a fork's main branch also has head_branch main
            "github.event.workflow_run.head_repository.full_name == github.repository",
        ]:
            self.assertIn(condition, gate)
        self.assertIn("    needs: preflight\n", job(text, "release-please"))

    def test_the_release_builds_the_commit_ci_checked(self):
        text = read(".github", "workflows", "release.yml")
        self.assertIn("ref: ${{ github.event.workflow_run.head_sha }}", job(text, "preflight"))
        self.assertIn("ref: ${{ github.event.workflow_run.head_sha || github.sha }}", job(text, "pages"))
        # Every checkout names its commit: on workflow_run the default is the newest main, not the commit CI checked
        for name in ["preflight", "build", "web-build", "pages"]:
            for checkout in job(text, name).split("uses: actions/checkout@")[1:]:
                self.assertIn("ref:", checkout.split("\n      - ")[0], name)

    def test_a_manual_run_keeps_its_dry_run(self):
        text = read(".github", "workflows", "release.yml")
        self.assertIn("  workflow_dispatch:\n    inputs:\n      dry_run:", text)
        for name in ["build", "web-build"]:
            self.assertIn("(github.event_name == 'workflow_dispatch' && inputs.dry_run == true)", job(text, name))
        self.assertIn(
            "(github.event_name == 'workflow_dispatch' && inputs.dry_run == false && github.ref == 'refs/heads/main')",
            job(text, "pages"),
        )

    def test_a_release_is_published_after_its_files_are_attached(self):
        text = read(".github", "workflows", "release.yml")
        for name in ["publish", "publish-web"]:
            steps = job(text, name)
            self.assertLess(steps.index("gh release upload"), steps.index('gh release edit "$TAG" --draft=false'), name)
        # The site is built from published releases only
        self.assertIn("select(.isDraft | not)", job(text, "pages"))

    def test_a_web_release_is_checked_against_the_released_firmware_first(self):
        steps = job(read(".github", "workflows", "release.yml"), "preflight")
        # The decisions are the tool's, tested in test_web_release_check.py; the job runs each of its answers
        self.assertIn("git tag --list | python3 tools/web_release_check.py plan", steps)
        self.assertIn("gh release list --limit 200 --json tagName,isDraft,isPrerelease", steps)
        self.assertIn("| python3 tools/web_release_check.py latest-firmware", steps)
        cases = re.findall(r"^            ([a-z*]+)\)$", steps, re.M)
        self.assertEqual(cases, ["none", "source", "released", "*"])
        source = steps[steps.index("            source)") : steps.index("            released)")]
        self.assertIn("web_release_check.py check --protocol-header lib/ZenitProto/src/proto_limits.h", source)
        released = steps[steps.index("            released)") : steps.index("            *)")]
        self.assertIn("--pattern 'zenit-esp32c3-protocol.txt' --pattern SHA256SUMS", released)
        self.assertIn('web_release_check.py check --firmware "$RUNNER_TEMP/firmware"', released)
        self.assertTrue((ROOT / "lib" / "ZenitProto" / "src" / "proto_limits.h").is_file())

    def test_the_path_filter_runs_the_tests_when_a_document_they_read_changes(self):
        text = job(read(".github", "workflows", "ci.yml"), "changes")
        self.assertIn("steps.filter.outputs.specs == 'true'", text.split("\n    steps:")[0])
        pattern = re.search(r"\n            specs:\n              - '\{([^}]*)\}'\n", text)
        self.assertIsNotNone(pattern)
        specs = pattern.group(1).split(",")
        # web/test/model.test.ts reads the protocol and light specifications, this file the changelog
        for path in ["docs/protocol/protocol-v1.md", "docs/board/light-v1.md", "docs/web/web-app-v1.md", "CHANGELOG.md"]:
            self.assertTrue((ROOT / path).is_file(), path)
            self.assertTrue(any(path == s or (s.endswith("/**") and path.startswith(s[:-2])) for s in specs), path)

    def test_the_python_tools_are_installed_from_the_hashed_lock(self):
        lock = read("requirements-ci.txt")
        pins = re.findall(r"^([a-z0-9][a-z0-9._-]*)==(\S+)", read("requirements-ci.in"), re.M)
        self.assertTrue(pins)
        for name, version in pins:
            self.assertRegex(lock, rf"(?m)^{re.escape(name)}=={re.escape(version)} \\$", name)
        # Every package of the lock, dependencies included, has an exact version and at least one hash
        entries = re.split(r"\n(?=[a-z0-9])", lock[lock.index("\n", lock.index("pip-compile")) :].strip())
        self.assertGreater(len(entries), len(pins))
        for entry in entries:
            if entry.startswith("#"):
                continue
            self.assertRegex(entry, r"^[a-z0-9][a-z0-9._-]*==[^\s\\]+ \\\n\s+--hash=sha256:[0-9a-f]{64}", entry[:40])
        installs = 0
        for path in self.workflows():
            for line in path.read_text(encoding="utf-8").splitlines():
                if "pip install" in line:
                    installs += 1
                    self.assertIn("pip install --require-hashes -r requirements-ci.txt", line, path.name)
        self.assertGreaterEqual(installs, 2)

    def test_the_platformio_cache_follows_the_lock(self):
        setup = read(".github", "actions", "setup", "action.yml")
        key = re.search(r"key: platformio-.*hashFiles\(([^)]*)\)", setup)
        self.assertIn("'requirements-ci.txt'", key.group(1))

    def test_dependabot_updates_the_lock_and_gives_playwright_its_own_pull_request(self):
        text = read(".github", "dependabot.yml")
        self.assertIn('  - package-ecosystem: pip\n    directory: "/"\n', text)
        npm = text[text.index("package-ecosystem: npm") :]
        groups = npm[npm.index("    groups:\n") :]
        # A dependency joins the first group it matches
        self.assertLess(groups.index("      playwright:"), groups.index("      web:"))
        self.assertIn('      playwright:\n        patterns:\n          - "@playwright/test"\n', groups)
        self.assertIn('        exclude-patterns:\n          - "@playwright/test"\n', groups)
        self.assertIn("PLAYWRIGHT_IMAGE", npm)
        self.assertIn("PLAYWRIGHT_IMAGE: mcr.microsoft.com/playwright:", read(".github", "workflows", "ci.yml"))

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
