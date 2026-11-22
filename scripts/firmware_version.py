# SPDX-License-Identifier: GPL-3.0-or-later
"""PlatformIO post-build script: defines the firmware version and the board name for the project sources.

Both are defined only for the project sources (projenv), so a new commit rebuilds src/ and not the libraries.
The site address (tools/site_url.py) is defined the same way for the board envs.
The version follows docs/protocol/protocol-v1.md#firmware-version; the ZENIT_VERSION environment variable overrides it
(the release build sets it from the release tag).
"""

import importlib.util
import os
import sys

Import("env", "projenv")  # noqa: F821 - provided by PlatformIO (SCons)

# The version rules live in tools/fw_version.py
_spec = importlib.util.spec_from_file_location(
    "zenit_version", os.path.join(env.subst("$PROJECT_DIR"), "tools", "fw_version.py")  # noqa: F821
)
shared = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(shared)

BOARDS = {"native": "simulator", "native_test": "simulator", "esp32c3_test_http": "esp32c3"}


_site_spec = importlib.util.spec_from_file_location(
    "zenit_site_url", os.path.join(env.subst("$PROJECT_DIR"), "tools", "site_url.py")  # noqa: F821
)
site = importlib.util.module_from_spec(_site_spec)
sys.modules[_site_spec.name] = site
_site_spec.loader.exec_module(site)


def version():
    try:
        return shared.describe_version(env.subst("$PROJECT_DIR"))  # noqa: F821
    except ValueError as err:
        raise SystemExit(str(err))


def quoted(text):
    return env.StringifyMacro(text)  # noqa: F821


defines = [
    ("ZENIT_VERSION", quoted(version())),
    ("ZENIT_BOARD", quoted(BOARDS.get(env["PIOENV"], env["PIOENV"]))),  # noqa: F821
]
if env["PIOENV"] not in BOARDS or BOARDS[env["PIOENV"]] != "simulator":  # noqa: F821
    # The site address of the firmware: where the update manifest is, and the origin the WebSocket accepts.
    try:
        defines.append(("ZENIT_SITE_URL", quoted(site.site_url(os.environ.get("ZENIT_SITE_URL"), env["PIOENV"]))))  # noqa: F821
    except site.SiteUrlError as error:
        raise SystemExit(str(error))
    if env["PIOENV"] == site.TEST_ENV:  # noqa: F821
        defines.append("ZENIT_ALLOW_HTTP_UPDATES")
projenv.Append(CPPDEFINES=defines)  # noqa: F821
