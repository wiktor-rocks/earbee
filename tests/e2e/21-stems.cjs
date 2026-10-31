// Stems (src/features/stems/): the Stems section, separating the open
// song with the stem model (electron/stems/), Cancel, and a new file
// forgetting them. With the model exported into models/ (scripts/
// export-stem-model.py) it separates for real; without it, the download
// fails against the harness's stand-in fetch, which is checked instead.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const fs = require("fs");
const path = require("path");

module.exports = async function (h) {
  const { js, openFile, check, sleep, toasts, clearToasts, shot, FIXTURES } = h;

  const section = () =>
    js(`(() => {
      const s = document.getElementById("stemsSection");
      const part = (selector) => s?.querySelector(selector);
      return s && {
        hidden: s.hidden,
        action: part(".stems-action").hidden ? null : part(".stems-action").textContent,
        busy: part(".stems-busy").hidden ? null : part(".stems-status").textContent,
        ready: !part(".stems-ready").hidden,
      };
    })()`);
  const press = (selector) => js(`document.querySelector("#stemsSection ${selector}").click()`);
  // Until `done(state)`, or `ms` have passed; the last state.
  async function waitFor(done, ms) {
    let state = await section();
    for (let waited = 0; waited < ms && !done(state); waited += 100) {
      await sleep(100);
      state = await section();
    }
    return state;
  }
  const found = () =>
    js(`import("./src/features/stems/index.js").then(({ stemsFound }) => {
      const f = stemsFound();
      if (!f) return null;
      const level = (channel) => Math.sqrt(channel.reduce((sum, v) => sum + v * v, 0) / channel.length);
      return {
        sampleRate: f.sampleRate,
        length: f.length,
        names: Object.keys(f.stems).sort(),
        levels: Object.fromEntries(Object.entries(f.stems).map(([id, [left, right]]) => [id, level(left) + level(right)])),
        finite: Object.values(f.stems).every((channels) => channels.every((c) => c.every(Number.isFinite))),
      };
    })`);

  const model = fs.existsSync(path.join(__dirname, "..", "..", "models", "htdemucs-6s.onnx"));

  await openFile(path.join(FIXTURES, "verse-chorus.wav"));
  let state = await section();
  check("stems: the section shows once a file is open", state && !state.hidden, JSON.stringify(state));
  check(
    "stems: the button says whether the model has to be downloaded",
    model ? state?.action === "Separate the stems" : /download, once/.test(state?.action ?? ""),
    state?.action,
  );

  if (!model) {
    await clearToasts();
    await press(".stems-action");
    state = await waitFor((s) => s.action !== null && s.busy === null, 10_000);
    const message = await js(`document.getElementById("message").textContent`);
    check("stems: without the model, a failed download says so", /stem model/.test(message), message);
    check("stems: …and the button is back", state.action !== null, JSON.stringify(state));
    console.log("  (stems: models/htdemucs-6s.onnx isn't there, so nothing was separated)");
    return;
  }

  // Separating: progress, then the stems.
  await clearToasts();
  await press(".stems-action");
  state = await waitFor((s) => s.busy !== null, 5000);
  check("stems: separating shows what it's doing", /Reading the song|Separating/.test(state.busy ?? ""), state.busy);
  await waitFor((s) => /Separating/.test(s.busy ?? "") || s.ready, 30_000);
  await shot("stems-separating.png");
  state = await waitFor((s) => s.ready || (s.busy === null && s.action !== null), 120_000);
  check("stems: then they're ready", state.ready, JSON.stringify(state));
  await shot("stems-ready.png");
  check(
    "stems: …with a notification",
    (await toasts()).some((t) => /stems are ready/.test(t.text)),
  );
  const stems = await found();
  const duration = await h.duration();
  check(
    "stems: five stems at 44.1 kHz, as long as the song",
    stems &&
      stems.sampleRate === 44100 &&
      stems.names.join() === "bass,drums,guitar,piano,vocals" &&
      Math.abs(stems.length / 44100 - duration) < 0.01,
    JSON.stringify(stems && { ...stems, levels: undefined }),
  );
  check(
    "stems: they're sound, not silence or NaN",
    stems?.finite && Object.values(stems.levels).some((level) => level > 1e-3),
    JSON.stringify(stems?.levels),
  );

  // A new file forgets them; Cancel stops a separation.
  await openFile(path.join(FIXTURES, "bars.wav"));
  state = await section();
  check("stems: a new file forgets them", !state.ready && state.action === "Separate the stems", JSON.stringify(state));
  check("stems: …and what was found", (await found()) === null);
  await press(".stems-action");
  await waitFor((s) => s.busy !== null, 5000);
  await press(".stems-busy button");
  state = await waitFor((s) => s.busy === null, 2000);
  check("stems: Cancel stops it", state.action === "Separate the stems" && !state.ready, JSON.stringify(state));
  await sleep(500);
  state = await section();
  check("stems: …and nothing comes back later", !state.ready && state.busy === null, JSON.stringify(state));
};
