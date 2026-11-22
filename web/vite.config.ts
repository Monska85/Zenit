import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";
import { licenseFiles, thirdPartyNotices } from "./scripts/notices.ts";
import { repositoryUrl } from "./scripts/repository.ts";

// The Content Security Policy in index.html blocks the inline script that the development server needs for live
// reload, so only builds carry it.
const cspOnlyInBuilds = (): Plugin => ({
  name: "csp-only-in-builds",
  apply: "serve",
  transformIndexHtml: (html) => html.replace(/\s*<meta\s+http-equiv="Content-Security-Policy"[^>]*>/, ""),
});

const repository = repositoryUrl(process.env);

export default defineConfig({
  // Relative URLs: the build works at /<repository>/ and anywhere else.
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(
      (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version,
    ),
    __REPOSITORY_URL__: JSON.stringify(repository),
  },
  plugins: [react(), tailwindcss(), cspOnlyInBuilds(), ...thirdPartyNotices(repository), licenseFiles()],
  build: { outDir: "dist", sourcemap: false },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
