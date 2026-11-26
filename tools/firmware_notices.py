#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""The third-party notices of the firmware (LICENSES/README.md).

    tools/firmware_notices.py --version VERSION --out FILE [--source URL] [--build-dir DIR]

Reads the link map of the firmware (.pio/build/esp32c3/firmware.map), lists the third-party software the firmware
links, and writes the notices with the full text of every license.

The link map says which archives were linked and from which package, so the notices follow the build: versions are
read from the framework's library package and the compiler, and checked against the versions the texts in
LICENSES/firmware/ were taken from. An archive that no section of LICENSES/firmware.json names fails the run, so a new
dependency cannot be shipped without its notice.
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD_DIR = ROOT / ".pio" / "build"
LIBDEPS_DIR = ROOT / ".pio" / "libdeps"
LICENSES = ROOT / "LICENSES"
CONFIG = LICENSES / "firmware.json"
BOARD = "esp32c3"
REPOSITORY = "https://github.com/Monska85/Zenit"


class NoticesError(Exception):
    pass


def linked_archives(map_text):
    """The archives the linker took members from: the paths in the "Archive member included" part of a link map."""
    start = map_text.find("Archive member included")
    if start < 0:
        raise NoticesError("the link map has no list of included archive members")
    part = map_text[start:]
    end = re.search(r"^(Discarded input sections|Allocating common symbols|Memory Configuration)", part, re.M)
    if end:
        part = part[: end.start()]
    return sorted({m.group(1) for m in re.finditer(r"^(\S[^\n(]*?\.a)\(", part, re.M)})


def package_root(path):
    """The PlatformIO package an archive comes from, the folder below `packages/`, or None for a project build."""
    parts = Path(path).parts
    if "packages" not in parts:
        return None
    index = len(parts) - 1 - parts[::-1].index("packages")
    return Path(*parts[: index + 2])


def read_versions(libs_root):
    """versions.txt of a framework library package: each name with the first word of its value."""
    versions = {}
    for line in (libs_root / "versions.txt").read_text(encoding="utf-8").splitlines():
        name, sep, value = line.partition(":")
        if sep and value.split():
            versions[name.strip()] = value.split()[0]
    return versions


def package_version(root):
    return json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]


def library_metadata(folder):
    """Version and source address of a PlatformIO library, from library.json or library.properties."""
    meta = folder / "library.json"
    if meta.is_file():
        data = json.loads(meta.read_text(encoding="utf-8"))
        repository = data.get("repository")
        url = (repository.get("url") if isinstance(repository, dict) else repository) or ""
        return data.get("version"), url[: -len(".git")] if url.endswith(".git") else url
    properties = {}
    for line in (folder / "library.properties").read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep:
            properties[key.strip()] = value.strip()
    return properties.get("version"), properties.get("url", "")


def project_libraries(root=ROOT):
    """The project's own libraries in lib/, each with its library.json."""
    libraries = {}
    for folder in sorted((root / "lib").iterdir()):
        meta = folder / "library.json"
        if meta.is_file():
            libraries[folder.name] = json.loads(meta.read_text(encoding="utf-8"))
    return libraries


def check_pins(config, versions, arduino):
    pins = config["pins"]
    found = {"esp-idf": versions.get("esp-idf"), "arduino": arduino}
    expected = {"esp-idf": pins["esp-idf"], "arduino": pins["arduino"]}
    for name, version in pins["components"].items():
        found[name] = versions.get(name)
        expected[name] = version
    for name, version in expected.items():
        if found[name] != version:
            raise NoticesError(
                f"the build uses {name} {found[name]}, but the texts in LICENSES/firmware/ are those of {version}: "
                "take them again from the new version (LICENSES/README.md)"
            )


def section_version(section, versions, arduino, toolchain):
    kind = section["version"]
    if kind == "esp-idf":
        return versions["esp-idf"]
    if kind == "arduino":
        return arduino
    if kind == "toolchain":
        return toolchain
    if kind.startswith("component:"):
        name = kind.split(":", 1)[1]
        if name not in versions:
            raise NoticesError(f"versions.txt names no component {name}")
        return versions[name]
    raise NoticesError(f"unknown version source '{kind}'")


def read_license_file(file, toolchain_root, licenses=LICENSES):
    path = toolchain_root / file.split(":", 1)[1] if file.startswith("toolchain:") else licenses / "firmware" / file
    if not path.is_file():
        raise NoticesError(f"{path} not found")
    return path.name, path.read_text(encoding="utf-8", errors="replace")


class Notices:
    """What the firmware links, as sections of the configuration and libraries, with the license texts."""

    def __init__(self, config, project_libs, licenses=LICENSES):
        self.config = config
        self.project_libs = project_libs
        self.licenses = licenses
        self.by_archive = {}
        for index, section in enumerate(config["sections"]):
            for archive in section["archives"]:
                self.by_archive.setdefault(archive, []).append(index)
        self.sections = {}  # section index to {"versions": set, "files": list}
        self.libraries = {}  # library name to {"versions": set, "url": str, "files": list}

    def add_build(self, archives, libdeps):
        libs_root = toolchain_root = None
        for path in archives:
            root = package_root(path)
            if root is None:
                continue
            if root.name.startswith("framework-arduinoespressif32-") and root.name.endswith("-libs"):
                libs_root = root
            elif root.name.startswith("toolchain-"):
                toolchain_root = root
        if libs_root is None or toolchain_root is None:
            raise NoticesError("the link map names no framework library package or no compiler package")
        versions = read_versions(libs_root)
        arduino = package_version(libs_root)
        toolchain = package_version(toolchain_root)
        check_pins(self.config, versions, arduino)

        used = set()
        linked_project_libs = set()
        for path in archives:
            name = Path(path).name
            stem = name[len("lib") : -len(".a")] if name.startswith("lib") else name
            if package_root(path) is None and stem in self.project_libs:
                linked_project_libs.add(stem)
                continue
            if name not in self.by_archive:
                raise NoticesError(f"{path} is linked but no section of {CONFIG.relative_to(ROOT)} names {name}")
            used.update(self.by_archive[name])
        # Data the firmware embeds from the project, not from an archive (the certificate bundle)
        used.update(index for index, section in enumerate(self.config["sections"]) if section.get("always"))
        # A header-only library has no archive: it is compiled into the project library that depends on it
        for lib in sorted(linked_project_libs):
            for dependency in self.project_libs[lib].get("dependencies", []):
                name = (dependency["name"] if isinstance(dependency, dict) else dependency).split("/")[-1]
                if name not in self.project_libs:
                    self.add_library(libdeps / name)
        for index in sorted(used):
            section = self.config["sections"][index]
            version = section_version(section, versions, arduino, toolchain)
            entry = self.sections.setdefault(index, {"versions": set(), "files": []})
            entry["versions"].add(version)
            for file in section["files"]:
                text = read_license_file(file, toolchain_root, self.licenses)
                if text not in entry["files"]:
                    entry["files"].append(text)

    def add_library(self, folder):
        name = folder.name.split("@", 1)[0]
        known = self.config["libraries"].get(name)
        if known is None:
            raise NoticesError(f"the library {name} is linked but {CONFIG.relative_to(ROOT)} does not name it")
        if not folder.is_dir():
            raise NoticesError(f"{folder} not found: build the firmware first")
        version, url = library_metadata(folder)
        entry = self.libraries.setdefault(name, {"versions": set(), "url": url, "files": []})
        entry["versions"].add(version)
        for file in known["files"]:
            path = folder / file
            if not path.is_file():
                raise NoticesError(f"{path} not found: the license file of {name}")
            text = (file, path.read_text(encoding="utf-8", errors="replace"))
            if text not in entry["files"]:
                entry["files"].append(text)

    def render(self, version, source):
        texts = []  # (hash, label, text) in order of first use

        def numbers(files, owner):
            found = []
            for name, text in files:
                key = hashlib.sha256(text.encode("utf-8")).hexdigest()
                for i, (known, _, _) in enumerate(texts):
                    if known == key:
                        found.append(i + 1)
                        break
                else:
                    texts.append((key, f"{owner}: {name}", text))
                    found.append(len(texts))
            return ", ".join(f"[{n}]" for n in found)

        entries = []
        for index in sorted(self.sections):
            section, found = self.config["sections"][index], self.sections[index]
            versions = ", ".join(sorted(found["versions"]))
            entries.append(
                (
                    section["name"],
                    versions,
                    section["license"],
                    section["source"].replace("{version}", versions),
                    numbers(found["files"], section["name"]),
                )
            )
        for name in sorted(self.libraries):
            found = self.libraries[name]
            entries.append(
                (
                    name,
                    ", ".join(sorted(found["versions"])),
                    self.config["libraries"][name]["license"],
                    found["url"],
                    numbers(found["files"], name),
                )
            )

        lines = [
            f"Zenit firmware {version}: third-party notices",
            "",
            "The Zenit firmware is free software: you can redistribute it and/or modify it under the terms of the",
            "GNU General Public License, version 3 or (at your option) any later version, with the additional",
            "permission in LICENSE-EXCEPTION for the binary-only libraries Espressif distributes. The source code,",
            "LICENSE and LICENSE-EXCEPTION are at:",
            "",
            f"    {source}",
            "",
            "The firmware contains the third-party software below, as the build linked it. Each entry names its",
            "license; the full texts follow the list, numbered.",
            "",
        ]
        for n, (name, versions, license_name, where, license_numbers) in enumerate(entries, 1):
            lines += [
                f"{n}. {name}",
                f"   Version: {versions}",
                f"   License: {license_name}",
                f"   Source: {where}",
                f"   License text: {license_numbers}",
                "",
            ]
        lines += ["", "License texts", "============="]
        for i, (_, label, text) in enumerate(texts, 1):
            lines += ["", f"[{i}] {label}", "-" * 78, text.rstrip("\n"), ""]
        return "\n".join(lines) + "\n"


def build_notices(version, source, build_dir=BUILD_DIR, libdeps_dir=LIBDEPS_DIR, config_path=CONFIG, root=ROOT):
    config = json.loads(config_path.read_text(encoding="utf-8"))
    notices = Notices(config, project_libraries(root), config_path.parent)
    path = build_dir / BOARD / "firmware.map"
    if not path.is_file():
        raise NoticesError(f"{path} not found (pio run -e {BOARD})")
    archives = linked_archives(path.read_text(encoding="utf-8", errors="replace"))
    notices.add_build(archives, libdeps_dir / BOARD)
    return notices.render(version, source)


def source_of(version):
    """Where the source code of `version` is: its release tag for a release X.Y.Z, which does not move on as the
    repository does, else the repository."""
    if re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version):
        return f"{REPOSITORY}/tree/v{version}"
    return REPOSITORY


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", required=True, help="the firmware version the notices are for")
    parser.add_argument("--out", required=True, help="the file to write")
    parser.add_argument(
        "--source", help="where the source code is (default: the release tag vX.Y.Z for a version X.Y.Z, else the repository)"
    )
    parser.add_argument("--build-dir", type=Path, default=BUILD_DIR)
    args = parser.parse_args(argv)
    try:
        text = build_notices(args.version, args.source or source_of(args.version), build_dir=args.build_dir)
        Path(args.out).write_text(text, encoding="utf-8")
    except (NoticesError, OSError, ValueError, KeyError) as error:
        sys.exit(f"firmware_notices: {error}")


if __name__ == "__main__":
    main()
