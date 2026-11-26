import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist", "node_modules", "coverage", "test-results*", "playwright-report*"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Text from the board is only ever rendered as React text.
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "Render text from the board as React text.",
        },
        {
          selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
          message: "Render text from the board as React text.",
        },
      ],
    },
  },
  {
    // The protocol, the light model, the release, device and WiFi models run in Node too (tests): nothing from the
    // page, except what a transport is given.
    files: [
      "src/protocol/**/*.ts",
      "src/light/**/*.ts",
      "src/release/**/*.ts",
      "src/device/**/*.ts",
      "src/wifi/**/*.ts",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "localStorage",
        "sessionStorage",
        "navigator",
        "location",
      ],
    },
  },
  {
    files: [
      "test/**/*.ts",
      "e2e/**/*.{ts,mjs}",
      "screenshots/**/*.ts",
      "scripts/**/*.{mjs,ts}",
      "*.config.ts",
      "*.config.js",
    ],
    languageOptions: { globals: globals.node },
  },
);
