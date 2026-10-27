// Runs the unit tests (tests/unit, plain Node, about a second), then the
// end-to-end tests (run.cjs) in Electron, then the smoke test of the real
// app (smoke.cjs). Stops at the first group that fails.
//   - Generates the test media first if it is missing (make-fixtures.sh).
//   - Clears ELECTRON_RUN_AS_NODE, which VS Code's terminal sets and which
//     would make Electron run as plain Node.
//   - Uses a throwaway profile directory, so runs don't share state.
//   - TB_APP_PATH=<dir> makes run.cjs test another copy of the app's files
//     (e.g. a packaged build's resources/app.asar) instead of the project;
//     TB_APP_BINARY=<file> makes smoke.cjs start a packaged executable.
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tests = __dirname;

const unit = spawnSync(process.execPath, ["--test", path.join(__dirname, "unit", "*.test.mjs")], { stdio: "inherit" });
if (unit.status !== 0) process.exit(unit.status ?? 1);
const fixtures = path.join(tests, "fixtures");
const needed = [
  "tone.wav",
  "counter.webm",
  "bad.mp3",
  "dl-audio.m4a",
  "dl-video.webm",
  "long-chirp.mp3",
  "long-chirp.m4a",
  "long-chirp.webm",
  "quiet-spike.wav",
  "loud-beats.wav",
  "stereo-left.wav",
  "verse-chorus.wav",
  "long-counter.webm",
  "clicks.wav",
  "bars.wav",
  "rotated.mp4",
];

if (!needed.every((name) => fs.existsSync(path.join(fixtures, name)))) {
  const made = spawnSync("bash", [path.join(tests, "make-fixtures.sh")], { stdio: "inherit" });
  if (made.status !== 0) process.exit(made.status ?? 1);
}

const electron = require("electron"); // path to the Electron binary
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "earbee-test-"));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const run = spawnSync(electron, [path.join(tests, "run.cjs"), `--user-data-dir=${profile}`], {
  stdio: "inherit",
  env,
});
fs.rmSync(profile, { recursive: true, force: true });
// A null status means Electron died (a crash, out of memory): a failure.
if (run.status !== 0) process.exit(run.status ?? 1);

// Then the real app, main.js included (see smoke.cjs).
const smoke = spawnSync(process.execPath, [path.join(tests, "smoke.cjs")], { stdio: "inherit", env });
process.exit(smoke.status ?? 1);
