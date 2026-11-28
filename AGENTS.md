# Agent rules

## Project Overview

Zenit is ESP32 firmware that drives LEDs through MOSFET outputs, with WiFi control, over-the-air (OTA) firmware updates and a web app to manage the board. It is a star projector: one RGBW power LED under a perforated dome.

**Tech stack:** C++17 on Arduino-ESP32 3.3.x with PlatformIO `espressif32`, ESP32-C3 SuperMini, LEDC PWM on four channels, FreeRTOS tasks, NVS, a host simulator built from the same sources, Python tools, and a React, TypeScript and Vite web app in `web/`, built in this repository.

**Process:** full rigor from the first release (specifications, ADRs, simulator, native and web tests, end-to-end tests, screenshots, release-please, full CI). Deadline for the first units: 2026-12-25.

**Status:** milestone 4 done (WiFi, the protocol over WiFi, Improv, the board serving the web app from its own partition, firmware updates with rollback and web app updates); real-network and over-the-air tests with the owner follow. Read these before any work:

1. The local planning notes, when present (excluded from Git): the current state, the order of the phases and the next step. Update them at the end of every session.
2. `docs/requirements/firmware-v1.md`: what the firmware must do, the decisions taken and the proposals still open.
3. `docs/reference/hardware.md`: the board, the LED, the MOSFET modules, the pins, the electrical and thermal limits.
4. `docs/adr/` and the specifications in `docs/`: [`docs/protocol/protocol-v1.md`](docs/protocol/protocol-v1.md), [`docs/board/light-v1.md`](docs/board/light-v1.md) and [`docs/web/web-app-v1.md`](docs/web/web-app-v1.md).

## Language

- Everything in the repository is in English: code, comments, documentation, commit messages, pull requests, file and folder names. No Italian word may appear.
- Source material may arrive in Italian (the project plan, the wiring guide, messages). When the repository needs it as reference, translate it into an English document under `docs/reference/`; never copy Italian text or file names into the repository.

When this file and the repository disagree, the repository wins: fix this file in the same change.

## Working method

- Every phase starts with a specification in `docs/` and an ADR in `docs/adr/`, reviewed by the user before any code. The user discusses the design first and says explicitly when to implement.
- Each change has a spec pack (`goal.md`, `decisions.md`, `architecture.md`, `tasks.md`) in the local planning notes, excluded from Git. Packs are drafts: refine them with the user before implementation starts.
- Work in phases: foundation (project, simulator, output engine), command protocol, web app, WiFi and OTA, then features.
- Do not run the full local gates while implementing. Run them once when the implementation is complete, then once after each round of review fixes. Targeted tests of the code being touched are fine at any time.
- The real board is the final check. Each phase that touches hardware has a written board test plan, and the board is put back in a known state afterwards.
- Measure on the board instead of guessing (stack, heap, firmware size, timing, PWM output) and record the numbers in the specification or the pull request.

## Key Conventions

These apply as soon as the matching code exists. The reasons are in `docs/adr/`.

- **Pure logic in `lib/`, hardware in `src/`.** Decisions (state machines, parsing, validation, fades, schedules, update rules) are plain C++ in `lib/<Name>/` with no Arduino or ESP-IDF calls, so the simulator and the tests run them unchanged.
- **Board and simulator pairs.** Code that touches hardware comes as `src/<module>_board.cpp` and `src/<module>_sim.cpp`, chosen by a simulator define. Shared code stays in `src/<module>.cpp`, its header in `include/<module>.h`.
- **Two FreeRTOS tasks.** The loop task owns the outputs, the settings, the files and every protocol request. The network task owns WiFi, NTP, HTTPS and the WebSocket server, only moves bytes, and hands work to the loop task through a static fixed-size queue. Cross-task state is read from a snapshot copied under a lock. At most one large allocation (a TLS connection or a file parse) exists at a time.
- **Safe outputs.** The MOSFET outputs have a defined state at boot, during an OTA installation, after a crash and after a brownout. Any change to output behavior states which outputs change and why.
- **Settings** live in NVS as one struct with defaults and a validator per field. A commit is all or nothing and writes only what changed.
- **Fixed flash layout from the first release:** NVS, OTA data, two equal firmware slots, the web app's `www` partition and a core dump partition, no file system, written out in `partitions.csv` (ADR 0001, ADR 0005). A layout change after the first release needs a USB reflash that erases the board's settings.
- **A/B OTA with rollback always on.** A new firmware boots on trial and confirms itself after a health check. A version that rolled back goes on a skip list, and downgrades are never installed over the network.
- **One command protocol for every transport** (USB serial and WebSocket): one line per message with a CRC-32, a `seq` with idempotent retries, strict JSON, stable error codes, and an `info` handshake that reports the version and the limits. Commands that change the WiFi network, the token or reset everything are USB only.
- **The protocol is `lib/ZenitProto/` plus `src/protocol.cpp`.** The checks of every request field, the strict JSON scan, the framing and the reply cache are pure C++ in the library; `protocol.cpp` only dispatches to `app::` and `settings::`. A new command or field gets its check there, its specification text and its conformance cases in the same change. Opening the serial port from a tool must not clear DTR or RTS before the other, or the ESP32-C3 restarts.
- **Limits are `constexpr`.** When a size, count or timing limit changes, check every place that enforces, advertises or tests it (firmware, simulator, web app, schemas, tools, specifications, conformance cases) and keep them equal where they describe the same contract.
- **Compatible formats.** Readers of protocol replies and published files ignore unknown optional fields but validate every known one. A request field the command does not define is an error.

## Web app

These apply to everything in `web/`. The reasons are in [ADR 0003](docs/adr/0003-web-app.md) and the rules in [`docs/web/web-app-v1.md`](docs/web/web-app-v1.md).

- **The client follows `tools/zenit.py` rule by rule** (framing, CRC, strict reply JSON, reply table, 2 s by 5 retries, one request in flight, `info` first, immediate resend on `bad_frame`). A change to a reply field changes `web/src/protocol/schema.ts` and `REPLIES` in the Python client together, with its cases in `conformance/client/replies.json`; both clients run those cases and the protocol conformance cases.
- **Web Serial never touches the control lines** (no `setSignals`): clearing DTR or RTS first restarts the ESP32-C3. Opening a port uses 115,200 baud and a buffer of 8,192 bytes.
- **Settings are sent when the user chooses them,** never while a slider moves. The limits in `web/src/light/model.ts` equal the protocol's and the light specification's; a test reads both documents.
- **The UI shows only what the board reports** (effects, colors, color sets from `info`) and, for an effect, only the settings it reads.
- **Text from the board is rendered as React text,** never as HTML, and the board's own error messages are never shown: each error code has a sentence.
- **No outside request,** no analytics, fonts or scripts from other sites; the content security policy and an end-to-end test enforce it. A change that breaks this is called out for approval and updates the privacy page and `docs/web/web-app-v1.md`.
- **Wording is plain and warm,** with no protocol terms on the Light view; the UI is English.
- **A new dependency of the web app** follows the dependency rules below, gets its license notice (the build fails on a bundled package that has no license text or a license GPL-3.0-or-later cannot include) and keeps the initial JavaScript under its size budget.
- **Reference screenshots are drawn inside the Playwright container** (`just web-screenshots-update`); look at the new images before committing them.

## Specifications and conformance

- Every change to a file format or to the command protocol updates its specification in `docs/` and adds conformance cases in `conformance/` in the same change.
- Conformance expected results are worked out by hand from the specification. Never generate them by running the firmware, the simulator or any engine.
- Tests outside the shipped content use their own fixture files, never the repository's real content.

## Code Style

- **C++:** `.clang-format` with the LLVM base style, 2-space indent, 120 columns, Allman braces, includes not sorted. Built with `-Os -std=gnu++17 -fno-exceptions -fno-unwind-tables -fno-asynchronous-unwind-tables`.
- **TypeScript:** `web/` is strict TypeScript, linted with ESLint (typescript-eslint, react-hooks) and formatted with Prettier (120 columns, trailing commas).
- **Documentation:** plain prose, without em dashes.

## Builds and tests

Run builds, tests and checks only through the `justfile` or `Makefile` recipes (`just --list`, `make help`), with their default limits (`JOBS` and `NICE`) unless the user asks for others. Never use hand-made `pio` commands with other parallelism. Run one build or test at a time, never two in parallel.

- `just check` is the gate before a change is done: formatting, the native tests with the conformance cases, the firmware and simulator builds, the tool tests (some run against the simulator program, so they follow its build) and the third-party notices of the firmware.
- The web app is not in the firmware: it is one read-only image in the board's `www` partition (ADR 0005), built by `just web-image` and written over USB by `just upload-web`; boards update it on their own from the site. A change to the image format updates `lib/ZenitNet/src/web_image.*`, `tools/web_image.py` and the specification together. The update test firmware (`just build-update-test`, environment `esp32c3_test_http`) reads updates from a plain `http://` test server and is never released; a release build accepts an `https://` site address only (`tools/site_url.py`).
- `just serve` serves the simulator on a local WebSocket and `just cli` runs `tools/zenit.py` against a board or the simulator; the board test plan of a phase uses the client.
- A new third-party library of the firmware needs its entry in `LICENSES/firmware.json` and its license text, or the notices step of `just check` fails.
- The time zone table `web/src/device/zones.json` is made by `tools/tz_table.py` from the `tzdata` package pinned in `requirements-ci.txt`, never edited by hand; `python3 tools/tz_table.py write` regenerates it when `tzdata` changes, and `just check` fails until it does.
- The certificate bundle in `certs/` is made by Espressif's generator through `tools/crt_bundle.py`, never edited by hand; regenerate it when the framework moves to another ESP-IDF release ([`certs/README.md`](certs/README.md)).
- When the light engine changes, compare the simulator's traces (`just sim`, every effect) before and after; a change meant to alter the output says which outputs change and why.
- When a change adds, moves or renames a top-level folder that CI reads, check the path filter of the `changes` job in `.github/workflows/ci.yml`.
- `just web-check` is the gate of the web app, and the web part of a change that touches `web/`: types, lint, formatting, unit and conformance tests, the build, the size budget, the end-to-end tests against the simulator and the reference screenshots (Docker). `just check` stays the firmware gate; CI runs both.
- Every C, C++, Python and TypeScript source file starts with `SPDX-License-Identifier: GPL-3.0-or-later` in a comment; build, configuration, markup, style and shell files carry none.

## Package Management

PlatformIO for the firmware (platforms and libraries pinned to exact versions in `platformio.ini`), pip for the CI tools (exact top-level versions in `requirements-ci.in`, compiled with pip-tools into `requirements-ci.txt` with every dependency pinned and hashed, installed with `--require-hashes`; pip-tools runs at lock time only, never as a project dependency), and npm with a committed lockfile in `web/` (`ignore-scripts=true`, exact versions, Node from `engines`).

### Dependency Safety

Before adding or upgrading any dependency:

1. **Never assume you know the latest version.** Check the live registry:

   ```bash
   curl -s https://registry.npmjs.org/<package>/latest | jq '{version: .version, engines: .engines}'
   curl -s https://pypi.org/pypi/<package>/json | jq '{version: .info.version, requires_python: .info.requires_python}'
   curl -s "https://api.registry.platformio.org/v3/packages/<owner>/library/<name>" | jq '{version: .version.name, released: .version.released_at}'
   ```

2. **Use the newest stable major version** compatible with the project runtime and boards.
3. **Avoid releases published within the last 5 days** to reduce supply chain risk.
4. **Pin exact versions** and regenerate the lockfile after changing a manifest, then install from the lock.
5. A new third-party dependency of the firmware or the web app gets its license notice in the same change.
6. **A major version that cannot be taken yet is capped in `.github/dependabot.yml`,** with a comment that names the condition that lifts it. The caps live only there. When updating dependencies, check each condition and remove the caps that are met in the same change that takes the new major.

## Privacy

- The web app keeps user data local. A change that sends any private information (settings, WiFi details, the token, anything the user enters or the board stores) out of the browser or the board, or adds an outside service, request, analytics or third-party script, is called out to the user for approval and updates the privacy documentation in the same change.
- Never write details of a contributor's machine into repository files: no local paths, device names, operating system names, user names or host names. Use synthetic values (WiFi names, board identifiers, tokens) in tests and documentation.
- **Privacy check, mandatory, no exceptions.** It runs before every commit, every push and every text published on GitHub (pull request and issue titles and bodies, comments, release notes), and covers every file the change adds, including images and generated files. Skipping it is never allowed, also for a one-line change or when the user is in a hurry.
  1. Read the whole staged diff (`git diff --cached`), not only its file list, and the full text to publish.
  2. Search the added lines: `git diff --cached -U0 | grep -nE '^\+' | grep -nEi '([0-9]{1,3}\.){3}[0-9]{1,3}|([0-9a-f]{2}:){5}[0-9a-f]{2}|zenit-[0-9a-f]{4}|/home/|/Users/|\\Users\\|@[a-z0-9-]+\.[a-z]{2,}|[A-Za-z0-9+/=_-]{32,}'`.
  3. Every match must be a synthetic value already used by the tests or the documentation (such as `zenit-a1b2`, `zenit-XXXX`, `10.0.0.5`, `192.168.1.20`) or public data (a release URL, a checksum, a pinned SHA). Compare each one with the real values seen during the work: the board names, addresses, WiFi names and tokens printed by the board, the client or the tools. A real one is replaced with a synthetic value before the commit.
  4. Look at every added or changed image (reference screenshots, previews) in full: no real WiFi name, board name, address, token or personal data.
  5. Never paste board logs, command output or `status`, `info` or `settings_get` replies into the repository or a GitHub text without replacing their real values.
  6. Say in the reply to the user that the check ran and what it found. When in doubt, stop and ask before committing.

## Git Workflow

The repository is `Monska85/Zenit` on GitHub, private until the first implementation is done, then public. Pull requests merge by squashing only: the commit on `main` takes the pull request title and nothing else, and the head branch is deleted after the merge. Local planning notes and agent settings are excluded in `.git/info/exclude`, never in `.gitignore`.

### Commits

Single-line Conventional Commits: lowercase description, imperative, no period. No body and no trailers of any kind.

```text
<type>[(scope)][!]: <description>
```

**Types:** `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `ci`, `build`, `style`, `revert`.

- Few commits. Each commit is one logical unit of work (a milestone, a feature, a review round), never one commit per file or per small edit. Squash local work before pushing.
- Pull request titles follow the same format, since they become the commit on `main`.

### Branching

- Branch names: `feat/`, `fix/`, `chore/`, `test/`, `docs/` prefix and a kebab-case description.
- First round (until the user says otherwise): commits go straight to `main` and are pushed there, with no pull requests.
- After the first round: never push to `main`. Changes reach `main` through pull requests.

### Rebasing

- Rebase onto `main` before pushing. No merge commits.
- Never force-push without the user's explicit approval.

## Command Safety

### Safe (run autonomously)

- Reading files, `git status`, `git log`, `git diff`.
- Builds, tests, format checks and the simulator, through the task runner, once it exists.

### Dangerous (ask user first)

- Flashing a board (`upload`, `upload-firmware`, `uploadfs`), erasing its flash or NVS, changing its settings over the protocol.
- Adding or upgrading dependencies.
- `git push`, opening pull or merge requests, creating tags or releases.

### Destructive (never run)

- `git push --force` without explicit approval, `rm -rf` outside build output folders.
- Changing `partitions.csv` after the first release without an approved ADR.

## Important Rules

- Read the local planning notes first, when present, and update them at the end of every session.
- Specification and ADR first; no code until the user says to implement.
- Pure logic in `lib/`, hardware behind `_board`/`_sim` pairs; the simulator and the tests run the same logic as the board.
- Outputs always have a defined safe state.
- Every protocol or format change updates its specification and conformance cases in the same change.
- Run builds and tests only through the task runner, one at a time.
- Verify every dependency version on the live registry; pin exact versions.
- No secrets, real WiFi names or machine details in the repository: run the privacy check before every commit, push and GitHub text.
- Edit `AGENTS.md`, never `CLAUDE.md`, which is a link to it.
