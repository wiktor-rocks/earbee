// ESLint checks for mistakes only; formatting is Prettier's job.
const js = require("@eslint/js");
const globals = require("globals");
const { importX } = require("eslint-plugin-import-x");

// The page's layers (src/). Imports only go downward:
//   core, themes, search → prefs, marks, project → config → audio, video, waveform, timeline → context → ui → features → app.js
// Each zone lists what a layer may not import.
const below = (target, ...from) => from.map((path) => ({ target, from: path }));
const layering = [
  // Themes are data plus pure logic, independent of everything else.
  ...below(
    "./src/themes",
    "./src/core",
    "./src/prefs",
    "./src/marks",
    "./src/project",
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
  // Search sources: data plus pure logic, shared with the main process
  // (prefs list them); they import nothing.
  ...below(
    "./src/search",
    "./src/core",
    "./src/themes",
    "./src/prefs",
    "./src/marks",
    "./src/project",
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
    "./src/project",
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
    "./src/project",
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
  // Project files: the frame around a session's saved sections; pure,
  // shared with the main process.
  ...below(
    "./src/project",
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
  { ignores: ["node_modules/", "dist/", "site/_site/", "src/vendor/", "tests/fixtures/", "tests/output/", "local/"] },
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
    // The decoder's and the beat finder's Workers: a worker's globals, not a page's.
    files: ["src/audio/decode-worker.js", "src/audio/beat-worker.js", "src/audio/open-track.js"],
    languageOptions: { globals: globals.worker },
  },
  {
    // Electron main process and preload, config and test runner: CommonJS in Node.
    files: ["electron/**/*.js", "eslint.config.js", "tests/**/*.cjs", "scripts/**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
  {
    // The preload runs in the page, before it: browser globals too.
    files: ["electron/preload.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // The splash window's script: a plain browser script.
    files: ["electron/splash.js"],
    languageOptions: { sourceType: "script", globals: globals.browser },
  },
  {
    // The website (site/): download.js is a plain browser script.
    files: ["site/**/*.js"],
    languageOptions: { sourceType: "script", globals: globals.browser },
  },
  {
    // ...and the Eleventy files that build it are ES modules in Node.
    files: ["site/eleventy.config.js", "site/**/*.11tydata.js"],
    languageOptions: { sourceType: "module", globals: globals.node },
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
