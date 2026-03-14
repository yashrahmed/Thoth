import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "db/local/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      import: importPlugin,
    },
    settings: {
      "import/resolver": {
        typescript: true,
      },
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "import/no-cycle": "error",
      "import/no-duplicates": "error",
      "import/no-unresolved": "off",
    },
  },
);
