// End-to-end tests for TranscriBee. Run with `npm test` (see launch.cjs).
//
// How it works
//   - The app's real index.html is loaded in an offscreen Electron window
//     rendering at 60 fps (a hidden window is throttled to ~1 fps, which
//     breaks anything driven by requestAnimationFrame).
//   - Input is real: keys, clicks, drags and wheel events go through
//     webContents.sendInputEvent, so the app's own handlers run.
//   - DevTools focus emulation makes the page behave as focused (needed for
//     :focus / keyboard-focus behaviour in an offscreen window).
//   - preload.cjs instruments the page: it records the Signalsmith worklet
//     node and AudioContext, offers __sample(ms) (per-frame position, worklet
//     input time, video frame time, waveform cursor), counts decode workers
//     (__workers) and offers an opt-in slow decode (window.__slowDecode =
//     ms, holding back the decoder's result) to observe loading states.
//   - Every network request is blocked, which also proves the app works
//     offline.
//   - Downloads run through the app's real preload.js and downloader.js,
//     with fake-yt-dlp.cjs in place of yt-dlp; files go to
//     tests/output/downloads.
//   - Media comes from tests/fixtures (make-fixtures.sh); screenshots go to
//     tests/output.
//
// Needs a display server (X11 or Wayland), even though nothing is shown.
//
// Layout: e2e/harness.cjs opens the app and holds the helpers (key, click,
// drag, openFile, shot, sample, …); each e2e/NN-topic.cjs file is one part
// of the sequence. They run in order and share the one window, so a
// topic starts where the previous one left off (e.g. a file is loaded).
//
// Adding a check: call h.check("what it proves", condition, detail) in
// the topic it belongs to (or a new topic, added to TOPICS below); the
// run fails if any check fails.

const { app } = require("electron");
const path = require("path");
const { prepare, createHarness, results } = require("./e2e/harness.cjs");

const TOPICS = [
  "01-static-ui.cjs",
  "02-welcome.cjs",
  "03-audio-and-loop.cjs",
  "04-space-replay.cjs",
  "05-stepping.cjs",
  "06-zoom.cjs",
  "07-errors.cjs",
  "08-video.cjs",
  "09-downloads.cjs",
  "10-themes.cjs",
  "11-parallel.cjs",
  "12-resources.cjs",
  "13-settings.cjs",
  "14-marks.cjs",
  "15-security.cjs",
  "16-projects.cjs",
  "17-waveform.cjs",
  "18-video-window.cjs", // Video window (src/features/video-window/)
];

prepare();
app
  .whenReady()
  .then(async () => {
    const h = await createHarness();
    // TB_TOPICS=10,03 runs only the topics whose names start with those
    // numbers (later topics may rely on what earlier ones loaded).
    const only = process.env.TB_TOPICS?.split(",").map((n) => n.trim().padStart(2, "0"));
    const topics = only ? TOPICS.filter((topic) => only.some((n) => topic.startsWith(`${n}-`))) : TOPICS;
    for (const topic of topics) await require(path.join(__dirname, "e2e", topic))(h);
    console.log(`\n${results.pass} pass, ${results.fail} fail`);
    app.exit(results.fail ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    app.exit(2);
  });
