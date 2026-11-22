# SPDX-License-Identifier: GPL-3.0-or-later
"""PlatformIO pre-build script for the board envs: embeds the built web app.

The web app (web/dist) becomes a source in the build folder (tools/web_assets.py), compiled into the firmware. The build
stops when the web app was not built.
"""

import importlib.util
import os
import sys

Import("env")  # noqa: F821 - provided by PlatformIO (SCons)

project = env.subst("$PROJECT_DIR")  # noqa: F821


def tool(name):
    spec = importlib.util.spec_from_file_location(
        "zenit_" + name, os.path.join(project, "tools", name + ".py")
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


assets = tool("web_assets")

generated = os.path.join(env.subst("$BUILD_DIR"), "web_assets_gen")  # noqa: F821
os.makedirs(generated, exist_ok=True)
source = os.path.join(generated, "web_assets.cpp")
header = os.path.join(project, "lib", "ZenitNet", "src", "net_http.h")
if assets.main(["--dist", os.path.join(project, "web", "dist"), "--out", source, "--header", header]) != 0:
    raise SystemExit("the web app is not built: run `just web-build`")
env.BuildSources(os.path.join("$BUILD_DIR", "web_assets"), generated)  # noqa: F821
