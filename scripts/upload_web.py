# SPDX-License-Identifier: GPL-3.0-or-later
"""PlatformIO script for the board envs: the `upload_web` target writes the web image (`just web-image`) to the board's
`www` partition over USB, at the offset partitions.csv gives, with the platform's esptool and upload port.
"""

import os

Import("env")  # noqa: F821 - provided by PlatformIO (SCons)

project = env.subst("$PROJECT_DIR")  # noqa: F821
IMAGE = os.path.join(project, ".pio", "web", "zenit-web.bin")


def www_offset():
    with open(os.path.join(project, "partitions.csv"), encoding="utf-8") as table:
        for line in table:
            fields = [field.strip() for field in line.split("#", 1)[0].split(",")]
            if fields[0] == "www":
                return fields[3]
    raise SystemExit("partitions.csv has no www partition")


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
