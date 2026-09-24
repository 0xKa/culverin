import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "extension/src/wasm/generated/**",
      "extension/src/wasm/instance/**",
      "extension/dist/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
