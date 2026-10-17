// @ts-check
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import htmlEslint from "@html-eslint/eslint-plugin";
import customRules from "./eslint-rules/index.js";

export default defineConfig(
  globalIgnores(["dist", ".agents", "src-tauri/target", "src-tauri/gen"]),
  {
    name: "net-egress-boundary",
    // src/net is the egress boundary: only hooks (and net itself) may call
    // it. Components and pages go through hooks — one consumption layer.
    files: ["src/{components,pages,contexts,auth}/**/*.{ts,tsx}", "src/App.tsx"],
    ignores: ["**/*.test.*"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/net/*", "@/net"],
              message: "Import the hook layer (src/hooks) instead — src/net is the egress boundary.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "app/ts",
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    plugins: {
      custom: customRules,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "custom/no-placeholder-comments": "error",
      "no-warning-comments": ["error", { terms: ["fixme"] }],
    },
  },
  {
    name: "app/html",
    files: ["**/*.html"],
    extends: [htmlEslint.configs["flat/recommended"]],
    plugins: {
      custom: customRules,
    },
    rules: {
      "@html-eslint/require-meta-description": "error",
      "@html-eslint/require-meta-viewport": "error",
      "@html-eslint/require-open-graph-protocol": [
        "error",
        ["og:type", "og:title", "og:description"],
      ],
      // The manifest link below intentionally uses `rel="manifest"`; the
      // baseline data currently flags this attribute value as not widely
      // available, which is a false positive for our use case.
      "@html-eslint/use-baseline": "off",
      "custom/no-inline-script": "error",
      "custom/require-webmanifest": "error",
    },
  },
);
