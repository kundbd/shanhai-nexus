import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import next from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  next.configs["core-web-vitals"],
  reactHooks.configs.flat.recommended,
  { files: ["scripts/*.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly" } } },
  globalIgnores([".next/**", "next-env.d.ts", "output/**", "test-results/**", "playwright-report/**"]),
]);
