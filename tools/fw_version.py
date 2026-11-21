# SPDX-License-Identifier: GPL-3.0-or-later
"""The firmware version, used by scripts/firmware_version.py.

The rules are in docs/protocol/protocol-v1.md#firmware-version. Standard library only: the PlatformIO post script
imports this file by path.
"""

import os
import re
import subprocess

FIRMWARE_PREFIX = "v"
VERSION_VARIABLE = "ZENIT_VERSION"
SAFE_VERSION = re.compile(r"[0-9A-Za-z][0-9A-Za-z.+-]{0,63}")


def _version_key(tag, prefix):
    return tuple(int(part) for part in tag[len(prefix) :].split("."))


def git(root, *args):
    try:
        out = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def nearest_release(root, prefix=FIRMWARE_PREFIX):
    """The nearest release tag (exactly <prefix>X.Y.Z) as (version, commits since it, commit), or None."""
    quoted = re.escape(prefix)
    release_tag = re.compile(quoted + r"[0-9]+\.[0-9]+\.[0-9]+")
    described_form = re.compile(quoted + r"([0-9]+\.[0-9]+\.[0-9]+)-([0-9]+)-g([0-9a-f]+)")
    # Selects the candidates only: git's glob also matches v1.2.3-rc1, v1.2.3.4 and v1.2.3+b, which release_tag rejects.
    candidates = (git(root, "tag", "--list", f"{prefix}[0-9]*.[0-9]*.[0-9]*") or "").splitlines()
    releases = [tag for tag in candidates if release_tag.fullmatch(tag)]
    if not releases:
        return None
    matches = [arg for tag in releases for arg in ("--match", tag)]
    described = described_form.fullmatch(git(root, "describe", "--tags", "--long", *matches) or "")
    if not described:
        return None
    version, commits, sha = described.groups()
    # Several release tags on the commit describe chose: the highest version counts.
    here = (git(root, "tag", "--points-at", f"{prefix}{version}^{{commit}}") or "").splitlines()
    best = max(
        (t for t in here if release_tag.fullmatch(t)),
        key=lambda t: _version_key(t, prefix),
        default=f"{prefix}{version}",
    )
    return best[len(prefix) :], commits, sha


def describe_version(root, prefix=FIRMWARE_PREFIX, variable=VERSION_VARIABLE):
    """The version of the checkout in root. Raises ValueError for a bad override in the environment."""
    override = os.environ.get(variable, "").strip()
    if override:
        if not SAFE_VERSION.fullmatch(override):
            raise ValueError(f"{variable} '{override}' is not a valid version")
        return override

    release = nearest_release(root, prefix)
    if release:
        tag, commits, sha = release
    else:
        sha = git(root, "rev-parse", "--short", "HEAD")
        count = git(root, "rev-list", "--count", "HEAD")
        if not sha or not count:
            return "0.0.0-unknown"
        tag, commits = "0.0.0", count

    # Untracked files count too: a new source file that is not committed changes what is built. Ignored files do not.
    dirty = bool(git(root, "status", "--porcelain"))
    if commits == "0" and not dirty and release:
        return tag
    return f"{tag}-dev.{commits}+g{sha}{'.dirty' if dirty else ''}"
