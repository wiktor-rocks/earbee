// Records the landing page's demos (site/img) from the real app, each in
// the EarBee theme (-dark) and EarBee Light (-light), for the page's dark
// and light modes, with the Peak + loudness waveform:
//   clip-beats-<mode>.mp4 / .webp   B finds the beats, then → / ← by beat
//   clip-loop-<mode>.mp4 / .webp    \ loops a bar, Shift+] twice, then =
//   screenshot-<mode>.webp          beats, a named section, a bar looping, 0.75×
// and, once, the screenshot's scene playing while the theme changes:
//   clip-themes.mp4 / .webp         every theme for THEME_SECONDS, in the
//                                   order of the swatches in site/index.html
//
//   npx electron scripts/record-site-media.cjs --media=<demo file> [--only=themes]
//
// The demo file is a video with music under it (see site/README.md for
// how the current one was made). The scenes click at fixed times chosen
// for it (bars every ~1.33 s from 3.40 s), so a different file needs new
// times below. Needs ffmpeg, a display (the window is offscreen), and the
// test media (npm run test:fixtures), since it runs on the e2e harness.
//
// How: each scene opens the file fresh, zooms the waveform in with the
// wheel and drives the app with real keys and clicks. A clip's frames come
// from the offscreen window's paint events and go to ffmpeg at a steady
// 30 fps (the last frame repeats while nothing changes), first nearly
// lossless, then compressed. A poster is a frame from the end of its clip,
// so it shows the result (the themes clip's: its first theme, EarBee).
const { app } = require("electron");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { prepare, createHarness } = require("../tests/e2e/harness.cjs");

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const MEDIA = path.resolve(arg("media") ?? "");
const ONLY_THEMES = arg("only") === "themes"; // just the themes clip
const SITE_IMG = path.join(__dirname, "..", "site", "img");
const SIZE = { width: 1280, height: 800 }; // the whole window, in every clip and the screenshot
const FPS = 30;
// Each page mode, and the app's theme recorded for it.
const MODES = [
  ["dark", "earbee"],
  ["light", "earbee-light"],
];
// The themes clip shows each theme this long (data-seconds on the clip in
// site/index.html, which lights its swatch meanwhile), in the order of the
// swatches there: their data-id is the theme's id.
const THEME_SECONDS = 1.5;
const SWATCHES = [
  ...fs.readFileSync(path.join(__dirname, "..", "site", "index.html"), "utf8").matchAll(/<li data-id="([\w-]+)"/g),
].map((match) => match[1]);

// Records the window from now until the returned function is called.
function record(wc, file, { width, height }) {
  const ff = spawn("ffmpeg", [
    ...["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", `${width}x${height}`, "-r", String(FPS)],
    ...["-i", "-", "-c:v", "libx264", "-crf", "10", "-preset", "veryfast", "-pix_fmt", "yuv444p", file],
  ]);
  ff.stderr.on("data", (data) => process.stderr.write(data));
  let last = null;
  const onPaint = (_event, _dirty, image) => {
    const size = image.getSize();
    if (size.width === width && size.height === height) last = image.toBitmap();
  };
  wc.on("paint", onPaint);
  wc.invalidate();
  // A late tick writes the frames it missed, so the clip lasts as long as
  // the recording did (the timer slips when the app is busy).
  const start = Date.now();
  let written = 0;
  const timer = setInterval(() => {
    if (!last) return;
    const due = Math.floor(((Date.now() - start) * FPS) / 1000);
    for (; written < due; written++) ff.stdin.write(last);
  }, 1000 / FPS);
  return () =>
    new Promise((resolve) => {
      clearInterval(timer);
      wc.off("paint", onPaint);
      ff.on("close", resolve);
      ff.stdin.end();
    });
}

function ffmpeg(...args) {
  const run = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}`);
}

// The recording as a small silent MP4, and its poster: a frame from its
// end, or `posterAt` seconds from its start.
function encodeClip(raw, name, posterAt) {
  ffmpeg(
    ...["-i", raw, "-an", "-c:v", "libx264", "-crf", "27", "-preset", "slow"],
    ...["-tune", "animation", "-pix_fmt", "yuv420p", "-r", String(FPS), "-movflags", "+faststart"],
    path.join(SITE_IMG, `${name}.mp4`),
  );
  ffmpeg(
    ...(posterAt === undefined ? ["-sseof", "-1.3"] : ["-ss", String(posterAt)]),
    "-i",
    raw,
    "-frames:v",
    "1",
    "-c:v",
    "libwebp",
    "-quality",
    "82",
    path.join(SITE_IMG, `${name}.webp`),
  );
}

if (!fs.existsSync(MEDIA)) {
  console.error("Usage: npx electron scripts/record-site-media.cjs --media=<demo file>");
  process.exit(1);
}
prepare();
app
  .whenReady()
  .then(async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "earbee-site-media-"));
    const h = await createHarness();
    const { js, sleep, key, wc } = h;

    const beatsDone = () => js(`(() => { const t = beatInfo.textContent; return /BPM/.test(t) && !/%/.test(t); })()`);
    const waitBeats = async () => {
      for (let i = 0; i < 300 && !(await beatsDone()); i++) await sleep(50);
    };
    const view = () =>
      js(
        `(() => { const host = document.querySelector("#waveform > div").shadowRoot; const w = host.querySelector(".wrapper").getBoundingClientRect(); const c = document.getElementById("waveform").getBoundingClientRect(); return { wl: w.left, ww: w.width, cl: c.left, cw: c.width, y: c.top + c.height / 2 }; })()`,
      );
    // Zooms in with the wheel at `center` (which keeps its place) until
    // about `span` seconds are in view.
    const zoomTo = async (span, center) => {
      const duration = await h.duration();
      let sign = 1;
      for (let i = 0; i < 60; i++) {
        const v = await view();
        if ((v.cw / v.ww) * duration <= span) break;
        const x = Math.round(Math.min(v.cl + v.cw - 2, Math.max(v.cl + 2, v.wl + (center / duration) * v.ww)));
        wc.sendInputEvent({ type: "mouseWheel", x, y: Math.round(v.y), deltaX: 0, deltaY: sign * 120 });
        await sleep(80);
        if ((await view()).ww <= v.ww + 0.5) sign = -sign; // that way zoomed out
      }
    };
    // A click on the waveform, then the mouse out of the window, so no hover
    // line, time label or hover buttons are left behind.
    const seek = async (time) => {
      await h.click(time);
      wc.sendInputEvent({ type: "mouseLeave", x: -1, y: -1 });
      await sleep(250);
    };
    // The file opened fresh (the harness shows the whole track), the sidebar
    // shown or not, and zoomed in: the view becomes about
    // center × (1 − span / duration) … + span. Every click is inside it.
    const scene = async ({ sidebar, size, span, center, beats }) => {
      h.win.setContentSize(size.width, size.height);
      await h.openFile(MEDIA);
      if ((await js(`sidebar.hidden`)) === sidebar) await js(`sidebarToggle.click()`);
      await js(`document.activeElement.blur()`);
      await sleep(1000);
      await zoomTo(span, center);
      if (beats) {
        key("B");
        await waitBeats();
        await sleep(300);
      }
      await h.clearToasts(); // "Opened …" and the like
    };
    // The screenshot's scene: a section named "Main riff", one bar of it
    // looping, at 0.75×, not playing. View about 3.4–12.4 s.
    const riffScene = async () => {
      await scene({ sidebar: true, size: SIZE, span: 9, center: 6.5, beats: true });
      await js(`document.querySelector('#speedChips [data-speed="0.75"]').click(); document.activeElement.blur()`);
      await seek(4.72);
      key("R");
      await sleep(150);
      await seek(8.72);
      key("R");
      await sleep(300);
      const name = `document.querySelector('#marksList .mark-name')`;
      await js(`${name}.focus(); ${name}.select()`);
      wc.insertText("Main riff");
      key("Return");
      await sleep(200);
      await js(`document.activeElement.blur()`);
      await seek(6.5);
      key("\\");
      await sleep(200);
    };

    h.prefsStore.set("waveform", "style", "twoTone"); // Peak + loudness
    for (const [mode, theme] of ONLY_THEMES ? [] : MODES) {
      h.prefsStore.set("theme", "choice", theme);
      await sleep(500);
      // ---- Finding the beats, then → / ← by beat ----
      // A search first warms the model's process (it starts cold, taking
      // seconds), so in the clip the lines come quickly. View about 2.6–10.1 s.
      await scene({ sidebar: true, size: SIZE, span: 7.5, center: 4.3, beats: true });
      await scene({ sidebar: true, size: SIZE, span: 7.5, center: 4.3, beats: false });
      await seek(4.2);
      let stop = record(wc, path.join(work, `beats-${mode}.mkv`), SIZE);
      await sleep(1200);
      key("B");
      await waitBeats();
      await sleep(1500);
      for (let i = 0; i < 4; i++) {
        key("Right");
        await sleep(550);
      }
      await sleep(400);
      for (let i = 0; i < 2; i++) {
        key("Left");
        await sleep(550);
      }
      await sleep(1200);
      await stop();

      // ---- A bar looping, moved on twice, then doubled ----
      // View about 2.8–11.3 s: 3.40–4.72, 4.72–6.06, 6.06–7.38, then 6.06–8.72.
      await scene({ sidebar: true, size: SIZE, span: 8.5, center: 5.1, beats: true });
      await seek(3.6);
      stop = record(wc, path.join(work, `loop-${mode}.mkv`), SIZE);
      await sleep(700);
      key("Space");
      await sleep(600);
      key("\\");
      await sleep(3000);
      key("]", ["shift"]);
      await sleep(2800);
      key("]", ["shift"]);
      await sleep(2800);
      key("=");
      await sleep(3800);
      key("Space");
      await sleep(500);
      await stop();

      // ---- The screenshot ----
      await riffScene();
      key("Space");
      await sleep(900);
      key("Space");
      await sleep(600);
      wc.invalidate();
      await sleep(300);
      const still = path.join(work, `still-${mode}.png`);
      fs.writeFileSync(still, (await h.win.capturePage()).toPNG());

      encodeClip(path.join(work, `beats-${mode}.mkv`), `clip-beats-${mode}`);
      encodeClip(path.join(work, `loop-${mode}.mkv`), `clip-loop-${mode}`);
      ffmpeg("-i", still, "-c:v", "libwebp", "-quality", "86", path.join(SITE_IMG, `screenshot-${mode}.webp`));
    }

    // ---- The themes: the riff looping while the theme changes ----
    // Each change is due at its own time from the start, so the clip's
    // slots stay THEME_SECONDS long and match the page's swatches.
    if (SWATCHES.length === 0) throw new Error("No swatches (<li data-id=…>) found in site/index.html");
    h.prefsStore.set("theme", "choice", SWATCHES[0]);
    await riffScene();
    key("Space");
    await sleep(1000);
    const stop = record(wc, path.join(work, "themes.mkv"), SIZE);
    const start = Date.now();
    for (let i = 1; i <= SWATCHES.length; i++) {
      await sleep(start + i * THEME_SECONDS * 1000 - Date.now());
      if (i < SWATCHES.length) h.prefsStore.set("theme", "choice", SWATCHES[i]);
    }
    await stop();
    key("Space");
    encodeClip(path.join(work, "themes.mkv"), "clip-themes", THEME_SECONDS / 2);

    fs.rmSync(work, { recursive: true, force: true });
    console.log(
      ONLY_THEMES
        ? "Done: site/img/clip-themes"
        : "Done: site/img/clip-beats-*, clip-loop-*, screenshot-* (dark and light), clip-themes",
    );
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(2);
  });
