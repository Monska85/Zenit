# SPDX-License-Identifier: GPL-3.0-or-later
"""The site address a firmware is built with (docs/board/wifi-and-updates-v1.md#source).

The address is where the board reads its update manifest and the origin its WebSocket accepts. It comes from the
ZENIT_SITE_URL environment variable, or is the project's own site. A release build takes an `https://` address only; the
test build (`esp32c3_test_http`) also takes `http://` for a server on the local network, which a release build can
never do.

Standard library only.
"""

import re
import sys
from pathlib import Path

DEFAULT = "https://monska85.github.io/Zenit/"
TEST_ENV = "esp32c3_test_http"

# A host name or IPv4 address, an optional port, an optional path, and the final slash.
_ADDRESS = re.compile(r"(https?)://([A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?/")


def _max_site_url():
    """MAX_SITE_URL of lib/ZenitUpdate/src/manifest.h: the longest address the board's URL buffers can hold."""
    text = (Path(__file__).resolve().parent.parent / "lib" / "ZenitUpdate" / "src" / "manifest.h").read_text(encoding="utf-8")
    max_url = int(re.search(r"MAX_URL = (\d+);", text).group(1))
    max_file = int(re.search(r"MAX_FILE_NAME = (\d+);", text).group(1))
    return max_url - len("firmware/") - max_file


MAX_SITE_URL = _max_site_url()


class SiteUrlError(ValueError):
    pass


def site_url(value, env_name):
    """The address to build with: `value` (None or empty for the default), checked for the environment `env_name`."""
    url = value if value else DEFAULT
    match = _ADDRESS.fullmatch(url)
    if not match:
        raise SiteUrlError(f"ZENIT_SITE_URL '{url}' is not an address of the form https://host[:port]/path/")
    if len(url) > MAX_SITE_URL:
        raise SiteUrlError(f"ZENIT_SITE_URL is {len(url)} characters: the board builds its update URLs in {MAX_SITE_URL + 1 + 9 + 64}-character buffers, so an address is at most {MAX_SITE_URL}")
    scheme = match.group(1)
    if scheme == "http" and env_name != TEST_ENV:
        raise SiteUrlError(f"ZENIT_SITE_URL '{url}' is http: only the {TEST_ENV} environment accepts it")
    if match.group(4) and not 0 < int(match.group(4)[1:]) < 65536:
        raise SiteUrlError(f"ZENIT_SITE_URL '{url}' has a port out of range")
    if ".." in url:
        raise SiteUrlError(f"ZENIT_SITE_URL '{url}' holds '..'")
    return url
