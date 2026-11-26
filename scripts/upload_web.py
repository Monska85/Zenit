# SPDX-License-Identifier: GPL-3.0-or-later
"""PlatformIO script for the board envs: the `upload_web` target writes the web image (`just web-image`) to the board's
`www` partition over USB, at the offset partitions.csv gives, with the platform's esptool and upload port.
"""

import os
import sys

Import("env")  # noqa: F821 - provided by PlatformIO (SCons)

project = env.subst("$PROJECT_DIR")  # noqa: F821
IMAGE = os.path.join(project, ".pio", "web", "zenit-web.bin")

# The partition table is read by tools/release_assets.py, as for the release files
sys.path.insert(0, os.path.join(project, "tools"))
import release_assets  # noqa: E402


def www_offset():
    return hex(release_assets.partition("www", os.path.join(project, "partitions.csv"))[0])


def check_image(*_args, **_kwargs):
    if not os.path.isfile(IMAGE):
        raise SystemExit(f"{IMAGE} is missing: run `just web-image` first")


env.AddCustomTarget(  # noqa: F821
    name="upload_web",
    dependencies=None,
    actions=[
        check_image,
        env.VerboseAction(env.AutodetectUploadPort, "Looking for upload port..."),  # noqa: F821
        '"$UPLOADER" --chip esp32c3 --port "$UPLOAD_PORT" --baud $UPLOAD_SPEED write-flash %s "%s"' % (www_offset(), IMAGE),
    ],
    title="Upload web app",
    description="Write the web image to the www partition over USB",
)
