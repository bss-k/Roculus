import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    // Plain Node scripts: the Node globals they use.
    languageOptions: {
      globals: { process: "readonly", console: "readonly", fetch: "readonly", setTimeout: "readonly", AbortSignal: "readonly" },
    },
  },
);
