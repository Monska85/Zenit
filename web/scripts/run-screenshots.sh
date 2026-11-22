#!/bin/sh
# Runs the reference image comparison (screenshots/views.spec.ts) inside the official Playwright container, so the text
# of every page is drawn by the same browser build and fonts everywhere. `compare` checks the pages against
# screenshots/baselines/; `update` writes the reference images again.
#
#   PLAYWRIGHT_IMAGE  the image to use; by default the one of the pinned @playwright/test version (CI names it by digest)
#   ZENIT_JOBS        how many Playwright workers run (make and just set it from JOBS; default 2)
#
# More arguments go to Playwright, for example --grep dialog.
#
# The built app (web/dist) must exist: `just web-screenshots` makes it first.

set -eu

mode=${1:-compare}
[ $# -eq 0 ] || shift
case "$mode" in
  compare) script=screenshots ;;
  update) script=screenshots:update ;;
  *) echo "usage: $0 compare|update [playwright options]" >&2; exit 2 ;;
esac

root=$(cd "$(dirname "$0")/../.." && pwd)
version=$(sed -n 's/.*"@playwright\/test": "\([^"]*\)".*/\1/p' "$root/web/package.json")
[ -n "$version" ] || { echo "cannot read the @playwright/test version from web/package.json" >&2; exit 1; }
image=${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v$version-noble}
# A pinned image must be the one of the Playwright version in use, or the browser would not match the test runner.
case "$image" in
  *"v$version-"*) ;;
  *) echo "The image $image is not the one of @playwright/test $version: update PLAYWRIGHT_IMAGE (CI pins it by digest)." >&2; exit 1 ;;
esac

command -v docker >/dev/null 2>&1 || { echo "Docker is needed: the screenshots are drawn inside the Playwright container." >&2; exit 1; }

exec docker run --rm --init --ipc=host \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e CI="${CI:-}" \
  -e ZENIT_JOBS="${ZENIT_JOBS:-}" \
  -v "$root:/work" \
  -w /work/web \
  "$image" \
  npm run "$script" -- "$@"
