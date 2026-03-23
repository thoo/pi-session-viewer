import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const typeCheckedLanguageOptions = {
  ecmaVersion: "latest",
  sourceType: "module",
  parserOptions: {
    projectService: true,
    tsconfigRootDir: import.meta.dirname,
  },
};

const sharedTypeAwareRules = {
  "@typescript-eslint/consistent-type-imports": "error",
  "@typescript-eslint/no-explicit-any": "warn",
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-misused-promises": "error",
  "@typescript-eslint/no-unsafe-argument": "off",
  "@typescript-eslint/no-unsafe-assignment": "off",
  "@typescript-eslint/no-unsafe-member-access": "off",
  "@typescript-eslint/no-unsafe-return": "off",
};

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", ".cache/**"],
  },
  {
    files: [
      "server/**/*.ts",
      "tests/**/*.ts",
      "client/vite.config.ts",
      "vitest.config.ts",
    ],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      ...typeCheckedLanguageOptions,
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...sharedTypeAwareRules,
      complexity: ["error", 14],
    },
  },
  {
    files: ["client/**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      ...typeCheckedLanguageOptions,
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...sharedTypeAwareRules,
      "react-hooks/set-state-in-effect": "off",
      "react/react-in-jsx-scope": "off",
    },
  },
  eslintConfigPrettier,
);
