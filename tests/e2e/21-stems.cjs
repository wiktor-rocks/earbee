// Stems (src/features/stems/): the stretcher mixing stems into its input
// (the patch in src/vendor/signalsmith-stretch), the Stems section,
// separating the open song with the stem model (electron/stems/), the
// mixer (volume, solo, mute), Cancel, and a new file forgetting them. With
// the model exported into models/ (scripts/export-stem-model.py) it
// separates for real; without it, the download fails against the
// harness's stand-in fetch, which is checked instead.
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
        ready: !part(".stems-mixer").hidden,
        rows: [...s.querySelectorAll(".stems-row")].map((row) => ({
          id: row.dataset.stem,
          silent: row.classList.contains("silent"),
          solo: row.querySelector("button[title^=Solo]").ariaPressed === "true",
          mute: row.querySelector("button[title^=Mute]").ariaPressed === "true",
          volume: row.querySelector(".knob-value").textContent,
        })),
      };
    })()`);
  const press = (selector) => js(`document.querySelector(${JSON.stringify(`#stemsSection ${selector}`)}).click()`);
  // Until `done(state)`, or `ms` have passed; the last state.
  async function waitFor(done, ms) {
    let state = await section();
    for (let waited = 0; waited < ms && !done(state); waited += 100) {
      await sleep(100);
      state = await section();
    }
    return state;
  }
  const found = () => js(`import("./src/features/stems/index.js").then(({ stemsFound }) => stemsFound())`);

  {
    // The stretcher mixes stems into its input: offline renders of a
    // signal, without stems and with two that add up to it.
    const renders = await js(`(async () => {
      const { default: SignalsmithStretch } = await import("./src/vendor/signalsmith-stretch/SignalsmithStretch.mjs");
      const rate = 44100, n = rate * 2;
      const signal = Float32Array.from({ length: n }, (_, i) => Math.sin((i * i) / 4e6) * 0.5);
      // Two stems, 30 % and 70 % of the signal, in 16 bits.
      const stem = (share) => {
        const scale = 0.5 / 32767;
        return { scale, samples: Int16Array.from(signal, (v) => Math.round((v * share) / scale)) };
      };
      async function render(stems, gains, track = signal) {
        const context = new OfflineAudioContext(1, n, rate);
        const stretch = await SignalsmithStretch(context);
        stretch.connect(context.destination);
        await stretch.addBuffers([track.slice()]);
        if (stems) await stretch.addStems({ tracks: stems.map((s) => [s.samples.slice()]), scales: stems.map((s) => s.scale) });
        if (gains) await stretch.setStemGains(gains.stems, gains.other);
        await stretch.schedule({ active: true, input: 0, rate: 1, semitones: 0, output: 0 });
        return (await context.startRendering()).getChannelData(0);
      }
      const stems = [stem(0.3), stem(0.7)];
      const plain = await render();
      const compare = (rendered, factor, reference = plain) => {
        let max = 0, loud = 0;
        for (let i = 0; i < n; i++) { max = Math.max(max, Math.abs(rendered[i] - reference[i] * factor)); loud = Math.max(loud, Math.abs(reference[i])); }
        return { max, loud };
      };
      // The second stem played as a track of its own, without stems.
      const secondAlone = await render(null, null, Float32Array.from(stems[1].samples, (v) => v * stems[1].scale));
      return {
        loaded: compare(await render(stems), 1),
        full: compare(await render(stems, { stems: [1, 1], other: 1 }), 1),
        silent: compare(await render(stems, { stems: [0, 0], other: 0 }), 0),
        solo: compare(await render(stems, { stems: [0, 1], other: 0 }), 1, secondAlone),
        rest: compare(await render(stems, { stems: [0, 0], other: 1 }), 0),
      };
    })()`);
    const { loaded, full, silent, solo, rest } = renders;
    check(
      "stems: with stems loaded at full volume, the stretcher plays the track exactly as without",
      loaded.max === 0 && full.max === 0 && loaded.loud > 0.1,
      JSON.stringify({ loaded, full }),
    );
    check("stems: every gain at 0 is silence", silent.max === 0, JSON.stringify(silent));
    check(
      "stems: a stem alone plays as that stem would on its own",
      solo.max < 1e-6 && solo.loud > 0.1,
      JSON.stringify(solo),
    );
    check("stems: the rest is the track minus the stems", rest.max < 1e-3, JSON.stringify(rest));
  }

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
    "stems: five stems, at the song's rate and as long as it",
    stems &&
      stems.ids.join() === "vocals,drums,bass,guitar,piano" &&
      Math.abs(stems.length / stems.sampleRate - duration) < 0.01,
    JSON.stringify(stems),
  );
  check(
    "stems: they're sound, not silence or NaN",
    stems && Object.values(stems.levels).every(Number.isFinite) && Object.values(stems.levels).some((l) => l > 1e-3),
    JSON.stringify(stems?.levels),
  );

  // The mixer: a row per stem, "Other" last; solo, mute, reset.
  check(
    "stems: the mixer has a row per stem, all at full volume",
    state.rows.map((row) => row.id).join() === "vocals,drums,bass,guitar,piano,other" &&
      state.rows.every((row) => row.volume === "100%" && !row.solo && !row.mute && !row.silent),
    JSON.stringify(state.rows),
  );
  const row = (s, id) => s.rows.find((r) => r.id === id);
  await press(`[data-stem="guitar"] button[title^=Solo]`);
  state = await section();
  check(
    "stems: soloing the guitar leaves only it heard",
    row(state, "guitar").solo && state.rows.every((r) => r.silent === (r.id !== "guitar")),
    JSON.stringify(state.rows),
  );
  await press(`[data-stem="guitar"] button[title^=Solo]`);
  await press(`[data-stem="guitar"] button[title^=Mute]`);
  state = await section();
  check(
    "stems: muting it leaves the rest",
    row(state, "guitar").mute && state.rows.every((r) => r.silent === (r.id === "guitar")),
    JSON.stringify(state.rows),
  );
  await press(`.dock-title button[aria-label="Reset the stems"]`);
  state = await section();
  check(
    "stems: Reset puts them all back",
    state.rows.every((r) => !r.solo && !r.mute && !r.silent && r.volume === "100%"),
    JSON.stringify(state.rows),
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
