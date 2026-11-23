import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: ["dist/**", "dist-electron/**", "node_modules/**", "scripts/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "electron/**/*.ts"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*/*"],
              message:
                "Cross-feature deep imports are banned. Import from the feature barrel '@/features/<name>' instead.",
            },
          ],
          paths: [
            {
              name: "@xterm/xterm",
              message:
                "@xterm/xterm is restricted to src/features/inspector/** and must be lazy-loaded.",
            },
            {
              name: "@xterm/addon-fit",
              message:
                "@xterm/addon-fit is restricted to src/features/inspector/** and must be lazy-loaded.",
            },
            {
              name: "shiki",
              message:
                "shiki is restricted to src/features/inspector/** and src/features/changes/** and must be lazy-loaded.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/features/inspector/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*/*"],
              message:
                "Cross-feature deep imports are banned. Import from '@/features/<name>' instead.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/features/changes/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*/*"],
              message:
                "Cross-feature deep imports are banned. Import from '@/features/<name>' instead.",
            },
          ],
          paths: [
            {
              name: "@xterm/xterm",
              message: "@xterm/xterm is restricted to src/features/inspector/**.",
            },
            {
              name: "@xterm/addon-fit",
              message: "@xterm/addon-fit is restricted to src/features/inspector/**.",
            },
          ],
        },
      ],
    },
  }
);
