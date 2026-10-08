// Starts the end-to-end tests (run.cjs) in Electron.
//   - Generates the test media first if it is missing (make-fixtures.sh).
//   - Clears ELECTRON_RUN_AS_NODE, which VS Code's terminal sets and which
//     would make Electron run as plain Node.
//   - Uses a throwaway profile directory, so runs don't share state.
//   - TB_APP_PATH=<dir> tests another copy of the app (e.g. a packaged
//     build's unpacked resources/app) instead of the project root.
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tests = __dirname;
const fixtures = path.join(tests, "fixtures");
const needed = ["tone.wav", "counter.webm", "bad.mp3"];

if (!needed.every((name) => fs.existsSync(path.join(fixtures, name)))) {
  const made = spawnSync("bash", [path.join(tests, "make-fixtures.sh")], { stdio: "inherit" });
  if (made.status !== 0) process.exit(made.status ?? 1);
}

const electron = require("electron"); // path to the Electron binary
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "transcribee-test-"));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const run = spawnSync(electron, [path.join(tests, "run.cjs"), `--user-data-dir=${profile}`], {
  stdio: "inherit",
  env,
});
fs.rmSync(profile, { recursive: true, force: true });
process.exit(run.status ?? 1);
