// SPDX-License-Identifier: GPL-3.0-or-later

// Serves what GitHub Pages would: the built app with a fixture firmware release under firmware/. A path that does not
// exist answers 404, as on Pages.

import { createServer } from "node:http";
import { cpSync, existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
const port = Number(process.env.PORT ?? 4173);

if (!existsSync(join(dist, "index.html"))) {
  console.error("web/dist is missing: run `just web-build` first.");
  process.exit(2);
}

const root = mkdtempSync(join(tmpdir(), "zenit-site-"));
cpSync(dist, root, { recursive: true });
cpSync(join(here, "site", "firmware"), join(root, "firmware"), { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".bin": "application/octet-stream",
};

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const file = normalize(join(root, path.endsWith("/") ? `${path}index.html` : path));
  if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found\n");
    return;
  }
  response
    .writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" })
    .end(readFileSync(file));
}).listen(port, "127.0.0.1", () => console.log(`serving ${root} on http://localhost:${port}`));
