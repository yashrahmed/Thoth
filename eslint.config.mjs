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
  {
    files: ["packages/conv-agent/src/application/**/*.ts"],
    ignores: ["packages/conv-agent/src/application/**/*.test.ts"],
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./packages/conv-agent/src/application",
              from: "./packages/conv-agent/src/domain/contracts",
              message:
                "Flows must not import repository or storage contracts directly; depend on domain services instead.",
            },
            {
              target: "./packages/conv-agent/src/application",
              from: "./packages/conv-agent/src/adapter/postgres",
              message:
                "Flows must not import repository implementations directly.",
            },
            {
              target: "./packages/conv-agent/src/application",
              from: "./packages/conv-agent/src/adapter/blob",
              message:
                "Flows must not import storage adapter implementations directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "packages/conv-agent/src/domain/contracts/**/*repository.ts",
      "packages/conv-agent/src/domain/contracts/blob-repository.ts",
      "packages/conv-agent/src/adapter/postgres/**/*.ts",
      "packages/conv-agent/src/adapter/blob/**/*.ts",
    ],
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./packages/conv-agent/src/domain/contracts",
              from: "./packages/conv-agent/src/application",
              message:
                "Repository and storage contracts must not import flows or other application code.",
            },
            {
              target: "./packages/conv-agent/src/adapter/postgres",
              from: "./packages/conv-agent/src/application",
              message:
                "Repository implementations must not import flows or other application code.",
            },
            {
              target: "./packages/conv-agent/src/adapter/blob",
              from: "./packages/conv-agent/src/application",
              message:
                "Storage adapter implementations must not import flows or other application code.",
            },
          ],
        },
      ],
    },
  },
);
