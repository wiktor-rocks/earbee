// ESLint checks for mistakes only; formatting is Prettier's job.
const js = require("@eslint/js");
const globals = require("globals");
const { importX } = require("eslint-plugin-import-x");

// The page's layers (src/). Imports only go downward:
//   core, themes → prefs, marks → config → audio, video, waveform, timeline → context → ui → features → app.js
// Each zone lists what a layer may not import.
const below = (target, ...from) => from.map((path) => ({ target, from: path }));
const layering = [
  // Themes are data plus pure logic, independent of everything else.
  ...below(
    "./src/themes",
    "./src/core",
    "./src/prefs",
    "./src/marks",
    "./src/config.js",
    "./src/audio",
    "./src/video",
    "./src/waveform.js",
    "./src/timeline.js",
    "./src/context.js",
    "./src/ui",
    "./src/features",
    "./src/app.js",
  ),
  ...below(
    "./src/core",
    "./src/prefs",
    "./src/marks",
    "./src/config.js",
    "./src/audio",
    "./src/video",
    "./src/waveform.js",
    "./src/timeline.js",
    "./src/context.js",
    "./src/ui",
    "./src/features",
    "./src/app.js",
  ),
  // Settings declarations: pure, shared with the main process; they may
  // use the themes and core, nothing below.
  ...below(
    "./src/prefs",
    "./src/marks",
    "./src/config.js",
    "./src/audio",
    "./src/video",
    "./src/waveform.js",
    "./src/timeline.js",
    "./src/context.js",
    "./src/ui",
    "./src/features",
    "./src/app.js",
  ),
  // Marks: what a mark is and the store; pure, like the settings.
  ...below(
    "./src/marks",
    "./src/prefs",
    "./src/config.js",
    "./src/audio",
    "./src/video",
    "./src/waveform.js",
    "./src/timeline.js",
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
    "./src/timeline.js",
    "./src/context.js",
    "./src/ui",
    "./src/features",
    "./src/app.js",
  ),
  ...["./src/audio", "./src/video", "./src/waveform.js", "./src/timeline.js"].flatMap((component) =>
    below(component, "./src/context.js", "./src/ui", "./src/features", "./src/app.js"),
  ),
  ...below("./src/context.js", "./src/ui", "./src/features", "./src/app.js"),
  ...below("./src/ui", "./src/features", "./src/app.js"),
  ...below("./src/features", "./src/app.js"),
];

module.exports = [
  { ignores: ["node_modules/", "dist/", "src/vendor/", "tests/fixtures/", "tests/output/"] },
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
    // The decoder's Worker: a worker's globals, not a page's.
    files: ["src/audio/decode-worker.js"],
    languageOptions: { globals: globals.worker },
  },
  {
    // Electron main process and preload, config and test runner: CommonJS in Node.
    files: ["electron/**/*.js", "eslint.config.js", "tests/**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
  {
    // The preload runs in the page, before it: browser globals too.
    files: ["electron/preload.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Unit tests: ES modules in Node.
    files: ["tests/**/*.mjs"],
    languageOptions: { sourceType: "module", globals: globals.node },
  },
  {
    rules: {
      "no-unused-vars": ["error", { args: "after-used", caughtErrors: "none" }],
    },
  },
];
