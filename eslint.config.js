// ESLint checks for mistakes only; formatting is Prettier's job.
const js = require("@eslint/js");
const globals = require("globals");
const { importX } = require("eslint-plugin-import-x");

// The page's layers (src/). Imports only go downward:
//   core → config → audio, video, waveform → context → ui → features → app.js
// Each zone lists what a layer may not import.
const below = (target, ...from) => from.map((path) => ({ target, from: path }));
const layering = [
  ...below(
    "./src/core",
    "./src/config.js",
    "./src/audio",
    "./src/video",
    "./src/waveform.js",
    "./src/context.js",
    "./src/ui",
    "./src/features",
    "./src/app.js",
  ),
  ...below(
    "./src/config.js",
    "./src/audio",
    "./src/video",
    "./src/waveform.js",
    "./src/context.js",
    "./src/ui",
    "./src/features",
    "./src/app.js",
  ),
  ...["./src/audio", "./src/video", "./src/waveform.js"].flatMap((component) =>
    below(component, "./src/context.js", "./src/ui", "./src/features", "./src/app.js"),
  ),
  ...below("./src/context.js", "./src/ui", "./src/features", "./src/app.js"),
  ...below("./src/ui", "./src/features", "./src/app.js"),
  ...below("./src/features", "./src/app.js"),
];

module.exports = [
  { ignores: ["node_modules/", "dist/", "tests/fixtures/", "tests/output/"] },
  js.configs.recommended,
  {
    // The page: ES modules running in Chromium.
    files: ["src/**/*.js"],
    languageOptions: { sourceType: "module", globals: globals.browser },
    plugins: { "import-x": importX },
    rules: {
      "import-x/no-cycle": "error",
      "import-x/no-restricted-paths": ["error", { zones: layering }],
    },
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
