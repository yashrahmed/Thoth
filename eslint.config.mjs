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
    files: ["packages/**/src/**/controllers/**/*.ts", "packages/**/src/**/controllers/**/*.tsx"],
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@thoth/entities",
              message:
                "Inbound adapters must not depend on domain entities or value objects.",
            },
            {
              name: "@thoth/contracts",
              importNames: [
                "BlobRepository",
                "ConversationRepository",
                "FileRepository",
                "MessageRepository",
              ],
              message:
                "Inbound adapters must not depend on repository interfaces.",
            },
          ],
          patterns: [
            {
              group: ["**/repositories/**"],
              message:
                "Inbound adapters must not depend on repository implementations.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/**/src/services/**/*.ts", "packages/**/src/services/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/repositories/**"],
              message:
                "Application services must depend on repository interfaces, not repository implementations.",
            },
            {
              group: ["**/controllers/**"],
              message:
                "Application services must not depend on inbound adapters.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/domain/**/*.ts", "packages/domain/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@thoth/config",
                "@thoth/agents",
                "pg",
                "ai",
                "**/controllers/**",
                "**/services/**",
                "**/repositories/**",
              ],
              message:
                "Domain code must not depend on application, infrastructure, or framework adapters.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/**/src/repositories/**/*.ts", "packages/**/src/repositories/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/controllers/**", "**/services/**"],
              message:
                "Outbound adapters must not depend on inbound adapters or application services.",
            },
          ],
        },
      ],
    },
  },
);
