import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Scraped page text is untrusted data: it may only reach the DOM as text, never as markup or code.
const FORBIDDEN_SYNTAX = [
  {
    selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
    message: "Never assign markup; use textContent or value.",
  },
  {
    selector: "CallExpression[callee.name='eval']",
    message: "eval is forbidden (Chrome Web Store remote-code policy).",
  },
  {
    selector: "NewExpression[callee.name='Function']",
    message: "new Function is forbidden (Chrome Web Store remote-code policy).",
  },
  {
    selector: "CallExpression[callee.property.name=/^(insertAdjacentHTML|write|writeln)$/]",
    message: "Markup injection is forbidden; build nodes with textContent.",
  },
  {
    selector: "CallExpression[callee.name=/^(setTimeout|setInterval)$/][arguments.0.type='Literal']",
    message: "String timers evaluate code; pass a function.",
  },
];

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "test/vectors.json"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "no-restricted-syntax": ["error", ...FORBIDDEN_SYNTAX],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        WebSocket: "readonly",
        setTimeout: "readonly",
      },
    },
  },
);
