// Stems (src/features/stems/): the stretcher mixing stems into its input
// (the patch in src/vendor/signalsmith-stretch), the Stems section,
// separating the open song with the stem model (electron/stems/), the
// mixer (volume, solo, mute), saving them in a project and bringing them
// back, Cancel, and a new file forgetting them. The harness's stand-in
// model makes each stem the song ÷ 6 (TB_STEM_MODEL=real: the real one,
// from models/); the model's download is checked by
// tests/unit/stems-model-file.test.mjs.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const fs = require("fs");
const path = require("path");

module.exports = async function (h) {
  const { js, openFile, setFiles, key, check, sleep, toasts, clearToasts, shot, projectDialogs, FIXTURES, OUTPUT } = h;

  const section = () =>
    js(`(() => {
      const s = document.getElementById("stemsSection");
      const part = (selector) => s?.querySelector(selector);
      return s && {
        hidden: s.hidden,
        action: part(".stems-action").hidden ? null : part(".stems-action").textContent,
        busy: part(".stems-busy").hidden ? null : part(".stems-status").textContent,
        ready: !part(".stems-mixer").hidden,
        preparing: part(".stems-preparing").hidden ? null : part(".stems-preparing").textContent,
        rows: [...s.querySelectorAll(".stems-row")].map((row) => ({
          id: row.dataset.stem,
          silent: row.classList.contains("silent"),
          solo: row.querySelector("button[title^=Solo]").ariaPressed === "true",
          mute: row.querySelector("button[title^=Mute]").ariaPressed === "true",
          volume: row.querySelector(".knob-value").textContent,
          pan: Number(row.querySelector(".stems-pan input").value),
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

  {
    // In stereo: a stem's 2×2 mix (its pan) moves it from side to side.
    // One stem holding the whole track, its left and right different.
    const pans = await js(`(async () => {
      const { default: SignalsmithStretch } = await import("./src/vendor/signalsmith-stretch/SignalsmithStretch.mjs");
      const { panMatrix } = await import("./src/features/stems/mix.js");
      const rate = 44100, n = rate * 2, scale = 0.5 / 32767;
      const left = Float32Array.from({ length: n }, (_, i) => Math.sin((i * i) / 4e6) * 0.4);
      const right = Float32Array.from({ length: n }, (_, i) => Math.sin(i / 7) * 0.4);
      const ints = [left, right].map((c) => Int16Array.from(c, (v) => Math.round(v / scale)));
      // The stem's own samples, as a track: the same input as the stem.
      const stemTrack = ints.map((c) => Float32Array.from(c, (v) => v * scale));
      async function render(gains, track = [left, right]) {
        const context = new OfflineAudioContext(2, n, rate);
        const stretch = await SignalsmithStretch(context);
        stretch.connect(context.destination);
        await stretch.addBuffers(track.map((c) => c.slice()));
        await stretch.addStems({ tracks: [ints.map((c) => c.slice())], scales: [scale] });
        if (gains) await stretch.setStemGains([gains], gains === 1 ? 1 : 0);
        await stretch.schedule({ active: true, input: 0, rate: 1, semitones: 0, output: 0 });
        const out = await context.startRendering();
        return [out.getChannelData(0), out.getChannelData(1)];
      }
      const loudest = (c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      const plain = await render(null);
      const stemAlone = await render(null, stemTrack);
      const centred = await render(panMatrix(0));
      const farLeft = await render(panMatrix(-100));
      let centredOff = 0;
      for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) centredOff = Math.max(centredOff, Math.abs(centred[c][i] - stemAlone[c][i]));
      return { centredOff, leftLoud: loudest(farLeft[0]), rightLoud: loudest(farLeft[1]), plainRight: loudest(plain[1]) };
    })()`);
    check(
      "stems: centred, a stem in stereo plays as itself, on both sides",
      pans.centredOff < 1e-6,
      JSON.stringify(pans),
    );
    check(
      "stems: panned fully left, it's all on the left and nothing on the right",
      pans.rightLoud < 1e-6 && pans.leftLoud > 0.3 && pans.plainRight > 0.1,
      JSON.stringify(pans),
    );
  }

  await openFile(path.join(FIXTURES, "verse-chorus.wav"));
  let state = await section();
  check("stems: the section shows once a file is open", state && !state.hidden, JSON.stringify(state));
  check("stems: with the model there, the button separates", state?.action === "Separate the stems", state?.action);

  // Separating: progress, then the stems.
  await clearToasts();
  await press(".stems-action");
  state = await waitFor((s) => s.busy !== null, 5000);
  check("stems: separating shows what it's doing", /Reading the song|Separating/.test(state.busy ?? ""), state.busy);
  await waitFor((s) => /Separating/.test(s.busy ?? "") || s.ready, 30_000);
  await shot("stems-separating.png");
  state = await waitFor((s) => s.ready || (s.busy === null && s.action !== null), 120_000);
  check("stems: then they're ready", state.ready, JSON.stringify(state));
  check(
    "stems: …to play while their copies for saving are still being made",
    state.ready && /Preparing them for saving/.test(state.preparing ?? ""),
    state.preparing,
  );
  await shot("stems-ready.png");
  check(
    "stems: …with a notification",
    (await toasts()).some((t) => /stems are ready/.test(t.text)),
  );
  const title = () => js(`document.title`);
  check("stems: new stems are an unsaved change as soon as they play", (await title()).endsWith(" •"), await title());

  // Saved at once, while their copies are still being made: the save waits for them.
  const early = path.join(OUTPUT, "projects", "Early.ebee");
  fs.mkdirSync(path.dirname(early), { recursive: true });
  fs.rmSync(early, { force: true });
  projectDialogs.save = early;
  key("S", ["control", "shift"]);
  await sleep(200);
  await js(`saveModeLink.click(); saveForm.requestSubmit()`);
  for (let i = 0; i < 300 && !fs.existsSync(early); i++) await sleep(100);
  await sleep(300);
  const earlyHeader = fs.existsSync(early)
    ? JSON.parse(fs.readFileSync(early).subarray(0, fs.readFileSync(early).indexOf(0)).toString() || "{}")
    : {};
  check(
    "stems: a save while they're being prepared waits for them, and keeps them",
    earlyHeader.version === 2 && Object.keys(earlyHeader.blobs ?? {}).length === 6,
    JSON.stringify({ version: earlyHeader.version, blobs: Object.keys(earlyHeader.blobs ?? {}).length }),
  );
  const stems = await found();
  const duration = await h.duration();
  check(
    "stems: six stems, at the song's rate and as long as it",
    stems &&
      stems.ids.join() === "vocals,drums,bass,guitar,piano,other" &&
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
  await press(`button[aria-label="Reset the stems"]`);
  state = await section();
  check(
    "stems: Reset puts them all back",
    state.rows.every((r) => !r.solo && !r.mute && !r.silent && r.volume === "100%"),
    JSON.stringify(state.rows),
  );

  // Saved in a project (with the song inside), and brought back from it,
  // once their copies for saving are made (while they already play).
  state = await waitFor((s) => s.preparing === null, 60_000);
  check("stems: their copies for saving get made", state.ready && state.preparing === null, JSON.stringify(state));
  await press(`[data-stem="drums"] button[title^=Mute]`);
  await press(`[data-stem="guitar"] button[title^=Solo]`);
  await js(
    `(() => { const i = document.querySelector('#stemsSection [data-stem="guitar"] .stems-pan input'); i.value = "-60"; i.dispatchEvent(new Event("input")); })()`,
  );
  const mixed = (await section()).rows;
  check(
    "stems: each row has a pan knob, and turning it sets the stem's pan",
    mixed.every((r) => Number.isFinite(r.pan)) && mixed.find((r) => r.id === "guitar").pan === -60,
    JSON.stringify(mixed),
  );
  const projectFile = path.join(OUTPUT, "projects", "Stems.ebee");
  fs.mkdirSync(path.dirname(projectFile), { recursive: true });
  fs.rmSync(projectFile, { force: true });
  projectDialogs.save = projectFile;
  key("S", ["control", "shift"]);
  await sleep(200);
  await js(`saveModeEmbed.click(); saveForm.requestSubmit()`);
  for (let i = 0; i < 100 && !fs.existsSync(projectFile); i++) await sleep(100);
  await sleep(300);
  const bytes = fs.existsSync(projectFile) ? fs.readFileSync(projectFile) : Buffer.alloc(0);
  const header = bytes.indexOf(0) > 0 ? JSON.parse(bytes.subarray(0, bytes.indexOf(0)).toString()) : null;
  const saved = header?.sections?.stems?.stems;
  check(
    "stems: a project keeps them as six Opus files after the song (version 2), and the mix",
    header?.version === 2 &&
      Object.keys(header.blobs ?? {}).length === 6 &&
      saved?.codec === "opus" &&
      saved.audio?.guitar?.blob === "stems/stems/audio/guitar" &&
      saved.mix?.guitar?.solo === true &&
      saved.mix?.guitar?.pan === -60 &&
      saved.mix?.drums?.mute === true,
    JSON.stringify({ version: header?.version, blobs: header?.blobs, mix: saved?.mix }),
  );
  const stemBytes = Object.values(header?.blobs ?? {}).reduce((sum, blob) => sum + blob.size, 0);
  console.log(`  (stems: ${(stemBytes / 1e6).toFixed(2)} MB of Opus for ${duration.toFixed(1)} s)`);
  check("stems: …and saved, nothing is unsaved", !(await title()).endsWith(" •"), await title());

  await openFile(path.join(FIXTURES, "bars.wav"));
  await setFiles(projectFile);
  state = await waitFor((s) => s.ready, 30_000);
  check(
    "stems: opening the project brings them back, with its mix",
    state.ready && JSON.stringify(state.rows) === JSON.stringify(mixed),
    JSON.stringify(state.rows),
  );
  const back = await found();
  check(
    "stems: …the same six, as loud as before",
    back?.ids.join() === stems.ids.join() &&
      back.length === stems.length &&
      back.ids.every((id) => Math.abs(back.levels[id] - stems.levels[id]) <= 0.05 * stems.levels[id] + 1e-4),
    JSON.stringify({ before: stems.levels, after: back?.levels }),
  );
  check("stems: …and that isn't an unsaved change", !(await title()).endsWith(" •"), await title());

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
