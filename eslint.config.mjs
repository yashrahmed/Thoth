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
    files: ["packages/**/src/**/inbound/**/*.ts", "packages/**/src/**/inbound/**/*.tsx"],
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
          ],
          patterns: [
            {
              group: ["**/outbound/**"],
              message:
                "Inbound adapters must not depend on outbound adapters.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/**/src/**/application/**/*.ts", "packages/**/src/**/application/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/outbound/**"],
              message:
                "Application code must depend on ports, not outbound adapters.",
            },
            {
              group: ["**/inbound/**"],
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
                "**/inbound/**",
                "**/application/**",
                "**/outbound/**",
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
    files: ["packages/**/src/**/outbound/**/*.ts", "packages/**/src/**/outbound/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/inbound/**", "**/application/**"],
              message:
                "Outbound adapters must not depend on inbound or application code.",
            },
          ],
        },
      ],
    },
  },
);
