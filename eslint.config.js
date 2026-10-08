// ESLint checks for mistakes only; formatting is Prettier's job.
const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  { ignores: ["node_modules/", "dist/", "tests/fixtures/", "tests/output/"] },
  js.configs.recommended,
  {
    // The renderer: an ES module running in Chromium.
    files: ["src/**/*.js"],
    languageOptions: { sourceType: "module", globals: globals.browser },
  },
  {
    // Electron main process and preload, config and test runner: CommonJS in Node.
    files: ["electron/**/*.js", "eslint.config.js", "tests/**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
  {
    rules: {
      "no-unused-vars": ["error", { args: "after-used", caughtErrors: "none" }],
    },
  },
];
