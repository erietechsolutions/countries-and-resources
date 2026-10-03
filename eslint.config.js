import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "data/**", "tools/geodata/.cache/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The simulation must stay headless so it can run on a server for multiplayer.
    files: ["packages/sim/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["@cr/ui", "@cr/ui/*", "react", "react-dom", "pixi.js"] },
      ],
      "no-restricted-globals": ["error", "window", "document", "localStorage", "fetch"],
    },
  },
  {
    files: ["packages/ui/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
