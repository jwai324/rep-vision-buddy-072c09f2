import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // Vendored shadcn/ui components. The shadcn CLI ships each one exporting
    // its cva variants or its context hook next to the component
    // (buttonVariants, badgeVariants, toggleVariants, navigationMenuTriggerStyle,
    // useFormField, useSidebar, sonner's toast re-export), and re-adding or
    // updating a component rewrites the file from the generator — so splitting
    // those exports out is a fight to be re-fought every time, for a
    // dev-server fast-refresh nicety.
    files: ["src/components/ui/**"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    // A provider component and its `useX` hook in one file is the standard
    // React context idiom, and what these files export beside the two belongs
    // with them: TutorialContext's step lists are the data its provider walks,
    // and ChatContext's proposal guards are the chat loop's own validation
    // layer, exported only so `src/test/chatProposalGuards.test.ts` can reach
    // them (they are typed against ChatContext's tool-call types and share its
    // module-private bounds helpers). Splitting every context in two would be
    // churn across the whole app for the same fast-refresh nicety.
    files: ["src/contexts/**"],
    rules: { "react-refresh/only-export-components": "off" },
  },
);
