# Zenit web app

A static React and TypeScript app (Vite) that controls a Zenit from the browser, over USB (Web Serial) or a WebSocket. The specification is [`docs/web/web-app-v1.md`](../docs/web/web-app-v1.md) and the decisions are in [ADR 0003](../docs/adr/0003-web-app.md).

## Commands

Run them from the repository root with `just` or `make` (`just --list`, `make help`). The app needs the Node.js version in the `engines` field of `package.json`. The recipes run `npm ci` the first time they need the dependencies, and honor `JOBS` and `NICE` like the others.

| Recipe                        | What it does                                                                |
| ----------------------------- | --------------------------------------------------------------------------- |
| `just web-install`            | Install the exact dependencies of `package-lock.json`.                      |
| `just web-dev`                | Start the app on `http://localhost:5173` with live reload.                  |
| `just web-test`               | Type check, lint, check the formatting, run the unit and conformance tests. |
| `just web-format`             | Format with Prettier.                                                       |
| `just web-build`              | Type check and build into `web/dist`.                                       |
| `just web-size`               | Build, then fail when the JavaScript loaded at start is over 150 KB gzip.   |
| `just web-e2e`                | Run the Playwright end-to-end tests and layout checks.                      |
| `just web-screenshots`        | Compare the reference screenshots (inside the Playwright container).        |
| `just web-screenshots-update` | Draw the reference screenshots again.                                       |
| `just web-check`              | All of the above but the first three: the whole web gate.                   |

Inside `web/`, the same steps are npm scripts (`npm run dev`, `typecheck`, `lint`, `format:check`, `test`, `build`, `size`, `e2e`, `screenshots`).

## Try it against the simulator

```sh
just serve     # the simulator on ws://127.0.0.1:8765
just web-dev   # in a second terminal
```

Open `http://localhost:5173`, type `ws://127.0.0.1:8765` and press Connect. Only one client at a time can use the simulator's bridge.

## Tests

- **Unit and conformance (Vitest, Node):** `test/`. The protocol client runs the cases of `conformance/protocol/` from its side; Web Serial runs against a fake port that fails the test if the control lines are touched; the limits are compared with the specifications.
- **End to end (Playwright, Chromium):** `e2e/`. The built app is served by `e2e/serve-site.mjs` with a fixture firmware release under `firmware/`, as Pages would. `e2e/fixtures.ts` starts the simulator behind `tools/ws_bridge.py` for each test (`just sim-build` first; `ZENIT_SIM`, `ZENIT_WS_BRIDGE` and `ZENIT_PYTHON` name other files). Tests that need a board that refuses, falls silent or reports something exact use `e2e/mock-board.ts`, which answers the app's WebSocket from a script, and `e2e/fake-serial.ts`, a Web Serial port wired to it. Install the browser once: `cd web && npx playwright install chromium`.
- **Layout checks and reference screenshots:** `screenshots/`. Every state is scripted once in `screenshots/states.ts`; see [`screenshots/README.md`](screenshots/README.md).

## Layout

- `src/protocol/`: CRC-32, the strict JSON reader, framing, the reply table, the client, the Web Serial and WebSocket transports, and the address rules. Nothing from the page.
- `src/light/`: the settings model, the limits and what each effect reads. Nothing from the page.
- `src/release/`: semantic version precedence and the firmware manifest. Nothing from the page.
- `src/board/`: the connection session (state, polling, errors) and the code that opens a port or a socket from the page.
- `src/ui/`: React views and components; `src/ui/components/` holds the shadcn-style components on Radix primitives. ESP Web Tools loads only when the install starts.
- `scripts/`: the third-party notices and the bundle size budget; `scripts/run-screenshots.sh` runs the screenshots in the container.
