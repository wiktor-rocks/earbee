// Runs the loading diagnostics: every measurement in PLAN, each in a fresh
// Electron process (profile-load.cjs), and writes the results to
// tests/output/diagnostics/results.json plus a summary table on stdout.
// Linux only. Takes about 15 minutes.
//
//   bash tests/diagnostics/make-long-media.sh   # once: the long test media
//   node tests/diagnostics/run.cjs              # everything
//   node tests/diagnostics/run.cjs app-mp3      # only ids containing "app-mp3"
//
// Memory-limited runs use systemd-run (a cgroup with MemoryMax and no
// swap) to show what happens on a machine with that much free memory.
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const MEDIA = path.join(__dirname, "..", "output", "long-media");
const OUTPUT = path.join(__dirname, "..", "output", "diagnostics");

// [mode, file, memory limit]
const PLAN = [
  // The app, as a user opens files: how load time and memory grow with length.
  ["app", "mp3-10min.mp3"],
  ["app", "mp3-30min.mp3"],
  ["app", "mp3-60min.mp3"],
  ["app", "mp3-120min.mp3"],
  // The same hour in other formats.
  ["app", "aac-60min.m4a"],
  ["app", "opus-60min.webm"],
  ["app", "wav-60min.wav"],
  ["app", "video-60min.mp4"],
  // An hour on machines with less free memory.
  ["app", "mp3-60min.mp3", "4G"],
  ["app", "mp3-60min.mp3", "3G"],
  ["app", "mp3-60min.mp3", "2G"],
  ["app", "video-60min.mp4", "3G"],
  // decodeAudioData alone (what the app's decode step costs), and with the
  // context at the file's own rate (no resampling).
  ["decode", "mp3-60min.mp3"],
  ["decode-native", "mp3-60min.mp3"],
  ["decode", "aac-60min.m4a"],
  ["decode", "wav-60min.wav"],
  ["decode", "opus-60min.webm"],
  // Where decodeAudioData starts failing: AAC fails at 60 min, MP3 at 120.
  ["decode", "aac-30min.m4a"],
  ["decode", "aac-45min.m4a"],
  ["decode", "mp3-90min.mp3"],
  // The alternative: streaming decode with mediabunny / WebCodecs.
  ["stream-discard", "mp3-60min.mp3"],
  ["stream-discard", "aac-60min.m4a"],
  ["stream-discard", "opus-60min.webm"],
  ["stream-discard", "wav-60min.wav"],
  ["stream-discard", "video-60min.mp4"],
  ["stream", "mp3-60min.mp3"],
  ["stream", "mp3-120min.mp3"],
  ["stream", "mp3-60min.mp3", "2G"],
];

const filter = process.argv[2] ?? "";
const electron = require("electron");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
fs.mkdirSync(OUTPUT, { recursive: true });

const results = [];
for (const [mode, file, limit] of PLAN) {
  const id = `${mode}-${file.replace(/\.\w+$/, "")}${limit ? `-limit${limit}` : ""}`;
  if (!id.includes(filter)) continue;
  const media = path.join(MEDIA, file);
  if (!fs.existsSync(media)) {
    console.log(`skip ${id}: ${file} missing (run make-long-media.sh)`);
    continue;
  }

  const out = path.join(OUTPUT, `${id}.json`);
  fs.rmSync(out, { force: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "transcribee-diag-"));
  const command = [electron, path.join(__dirname, "profile-load.cjs"), `--user-data-dir=${profile}`];
  const limited = limit
    ? ["systemd-run", ["--user", "--scope", "--quiet", "-p", `MemoryMax=${limit}`, "-p", "MemorySwapMax=0", ...command]]
    : [command[0], command.slice(1)];

  process.stdout.write(`${id} … `);
  const startedAt = Date.now();
  const run = spawnSync(limited[0], limited[1], {
    env: { ...env, TB_DIAG_MODE: mode, TB_DIAG_FILE: media, TB_DIAG_OUT: out, TB_DIAG_LIMIT: limit ?? "" },
    encoding: "utf8",
    timeout: 50 * 60_000,
  });
  fs.rmSync(profile, { recursive: true, force: true });

  // A killed process (e.g. the whole app OOM-killed) writes no result.
  const result = fs.existsSync(out)
    ? JSON.parse(fs.readFileSync(out, "utf8"))
    : {
        mode,
        file,
        memoryLimit: limit ?? null,
        outcome: `app process died (exit ${run.status}, signal ${run.signal})`,
        stderrTail: (run.stderr ?? "").split("\n").slice(-15).join("\n"),
      };
  result.id = id;
  result.wallMs = Date.now() - startedAt;
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  results.push(result);
  console.log(
    `${result.outcome}, ${result.loadMs ?? "?"} ms, peak renderer ${result.memory?.peakRendererMB ?? "?"} MB`,
  );
}

fs.writeFileSync(
  path.join(OUTPUT, filter ? `results-${filter}.json` : "results.json"),
  JSON.stringify(results, null, 2),
);

const seconds = (ms) => (ms == null ? "" : (ms / 1000).toFixed(1));
console.log("\nid | outcome | load s | steps (s) | peak renderer MB | peak all MB | frozen s (longest)");
for (const r of results) {
  const steps = r.steps
    ? Object.entries(r.steps)
        .map(([k, v]) => `${k} ${seconds(v)}`)
        .join(", ")
    : "";
  const frozen = r.heartbeat ? `${seconds(r.heartbeat.frozenMs)} (${seconds(r.heartbeat.maxGapMs)})` : "";
  console.log(
    [r.id, r.outcome, seconds(r.loadMs), steps, r.memory?.peakRendererMB, r.memory?.peakTotalMB, frozen].join(" | "),
  );
}
