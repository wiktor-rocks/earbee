// Stems (src/features/stems/): the stretcher mixing stems into its input
// (the patch in src/vendor/signalsmith-stretch), the Stems section,
// separating the open song with the stem model (electron/stems/), the
// mixer (volume, solo, mute), saving them in a project and bringing them
// back, the loop first and the rest after (Stop, saving part of a song,
// Separate the rest), the loop alone (in a window, replaced by the next,
// widened by the whole song), not enough memory (separating, a project's stems),
// Cancel, and a new file forgetting them. The harness's stand-in
// model makes each stem the song ÷ 6 (TB_STEM_MODEL=real: the real one,
// from models/); the model's download is checked by
// tests/unit/stems-model-file.test.mjs.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const fs = require("fs");
const path = require("path");

module.exports = async function (h) {
  const {
    js,
    openFile,
    setFiles,
    key,
    check,
    sleep,
    toasts,
    clearToasts,
    shot,
    projectDialogs,
    setStemDelay,
    setStemStartFails,
    setStemModelGone,
    memory,
  } = h;
  const { FIXTURES, OUTPUT } = h;

  const section = () =>
    js(`(() => {
      const s = document.getElementById("stemsSection");
      const part = (selector) => s?.querySelector(selector);
      return s && {
        hidden: s.hidden,
        action: part(".stems-whole").hidden ? null : part(".stems-whole").textContent,
        loop: part(".stems-loop").hidden ? null : part(".stems-loop").textContent,
        busy: part(".stems-busy").hidden ? null : part(".stems-status").textContent,
        ready: !part(".stems-mixer").hidden,
        preparing: part(".stems-preparing").hidden ? null : part(".stems-preparing").textContent,
        held: !part(".stems-held").hidden,
        folded: part(".stems-folded").hidden ? null : part(".stems-folded").textContent,
        // Calm rows: one knob each, nothing else to turn.
        knobsPerRow: [...s.querySelectorAll(".stems-row")].map((row) => row.querySelectorAll("input").length),
        panel: document.querySelector(".stems-menu:popover-open") && {
          name: document.querySelector(".stems-menu h3").textContent,
          volume: document.querySelectorAll(".stems-menu .knob-value")[0].textContent,
          pan: document.querySelectorAll(".stems-menu .knob-value")[1].textContent,
          fold: !document.querySelector(".stems-menu .menu-item").hidden,
        },
        rows: [...s.querySelectorAll(".stems-row")].map((row) => ({
          id: row.dataset.stem,
          silent: row.classList.contains("silent"),
          solo: row.querySelector("button[title^=Solo]").ariaPressed === "true",
          mute: row.querySelector("button[title^=Mute]").ariaPressed === "true",
          volume: Number(row.querySelector("input").value),
          name: row.querySelector(".stems-name").textContent,
          oneLine: row.querySelector(".stems-name").getBoundingClientRect().height < 24,
          hidden: row.hidden,
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

  {
    // Where the stems aren't separated yet, the track plays as it is: a
    // stem covering only the first half, every gain at 0.
    const halves = await js(`(async () => {
      const { default: SignalsmithStretch } = await import("./src/vendor/signalsmith-stretch/SignalsmithStretch.mjs");
      const rate = 44100, n = rate * 2, scale = 0.5 / 32767;
      const signal = Float32Array.from({ length: n }, (_, i) => Math.sin(i / 9) * 0.5);
      const ints = Int16Array.from(signal, (v) => Math.round(v / scale));
      const context = new OfflineAudioContext(1, n, rate);
      const stretch = await SignalsmithStretch(context);
      stretch.connect(context.destination);
      await stretch.addBuffers([signal.slice()]);
      await stretch.addStems({ tracks: [[new Int16Array(n)]], scales: [scale], covered: [] });
      // The first half comes later, as a piece.
      await stretch.writeStems(0, [[ints.slice(0, n / 2)]], [[0, n / 2]]);
      await stretch.setStemGains([0], 0);
      await stretch.schedule({ active: true, input: 0, rate: 1, semitones: 0, output: 0 });
      const out = (await context.startRendering()).getChannelData(0);
      const loudest = (from, to) => { let m = 0; for (let i = from; i < to; i++) m = Math.max(m, Math.abs(out[i])); return m; };
      // Away from the middle, where the stretcher's window spans both.
      return { first: loudest(rate * 0.1, rate * 0.8), second: loudest(rate * 1.3, rate * 1.9) };
    })()`);
    check(
      "stems: the mix applies where they're separated; elsewhere the track plays as it is",
      halves.first < 1e-4 && halves.second > 0.3,
      JSON.stringify(halves),
    );
  }

  await openFile(path.join(FIXTURES, "verse-chorus.wav"));
  let state = await section();
  check("stems: the section shows once a file is open", state && !state.hidden, JSON.stringify(state));
  check(
    "stems: with the model there, the button separates",
    state?.action === "Separate the whole song",
    state?.action,
  );

  // Separating: progress, then the stems.
  await clearToasts();
  await press(".stems-whole");
  state = await waitFor((s) => s.busy !== null, 5000);
  check("stems: separating shows what it's doing", /Reading the song|Separating/.test(state.busy ?? ""), state.busy);
  await waitFor((s) => /Separating/.test(s.busy ?? "") || s.ready, 30_000);
  await shot("stems-separating.png");
  // (The mixer shows once the first part is done; this waits for all of it.)
  state = await waitFor((s) => (s.ready && s.busy === null) || (s.busy === null && s.action !== null), 120_000);
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
      state.rows.every((row) => row.volume === 1 && !row.solo && !row.mute && !row.silent) &&
      state.knobsPerRow.every((n) => n === 1),
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
    state.rows.every((r) => !r.solo && !r.mute && !r.silent && r.volume === 1),
    JSON.stringify(state.rows),
  );

  // Saved in a project (with the song inside), and brought back from it,
  // once their copies for saving are made (while they already play).
  state = await waitFor((s) => s.preparing === null, 60_000);
  check("stems: their copies for saving get made", state.ready && state.preparing === null, JSON.stringify(state));
  await press(`[data-stem="drums"] button[title^=Mute]`);
  await press(`[data-stem="guitar"] button[title^=Solo]`);
  // A stem's panel, from its name: its volume and pan, and Fold into Other.
  const closePanel = () => js(`document.querySelector(".stems-menu").hidePopover()`);
  const setInPanel = (label, value) =>
    js(
      `(() => { const i = document.querySelector('.stems-menu input[aria-label="${label}"]'); i.value = "${value}"; i.dispatchEvent(new Event("input")); })()`,
    );
  await press(`[data-stem="guitar"] .stems-name`);
  await setInPanel("Pan", -60);
  await setInPanel("Volume", 1.5);
  state = await section();
  const guitarTip = await js(`document.querySelector('#stemsSection [data-stem="guitar"] .knob').title`);
  check(
    "stems: a stem's name opens its panel, where its pan is set, and its volume up to 200 %",
    state.panel?.name === "Guitar" &&
      state.panel.pan === "L 60" &&
      state.panel.volume === "150%" &&
      state.panel.fold &&
      guitarTip === "Guitar volume: 150%",
    JSON.stringify({ panel: state.panel, guitarTip }),
  );
  await shot("stems-panel.png");
  await closePanel();
  await press(`[data-stem="other"] .stems-name`);
  state = await section();
  check("stems: Other's panel has no Fold into Other", state.panel?.name === "Other" && !state.panel.fold);
  await closePanel();
  await press(`[data-stem="piano"] .stems-name`);
  await press(`.stems-menu .menu-item`);
  state = await section();
  let mixed = state.rows;
  check(
    "stems: folding the piano from its panel hides its row; Other keeps its name; the line says it",
    row(state, "piano").hidden &&
      row(state, "other").name === "Other" &&
      state.folded === "Piano is in Other · Show" &&
      state.rows.filter((r) => r.hidden).length === 1 &&
      state.panel === null &&
      state.rows.every((r) => r.hidden || r.oneLine),
    JSON.stringify({ folded: state.folded, panel: state.panel, rows: state.rows }),
  );
  await shot("stems-folded.png");
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
      saved.mix?.guitar?.volume === 1.5 &&
      saved.mix?.piano?.folded === true &&
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
  check("stems: …and the fold with it", state.folded === "Piano is in Other · Show", state.folded);
  await press(`[data-stem="guitar"] .stems-name`);
  state = await section();
  check(
    "stems: …and the guitar's pan and volume",
    state.panel?.pan === "L 60" && state.panel.volume === "150%",
    JSON.stringify(state.panel),
  );
  await closePanel();
  await press(`.stems-show`);
  state = await section();
  check(
    "stems: Show brings the piano back",
    !row(state, "piano").hidden && row(state, "other").name === "Other" && state.folded === null,
    JSON.stringify({ folded: state.folded, piano: row(state, "piano"), other: row(state, "other") }),
  );

  // A project's stems without memory enough for them: it opens without
  // them and says so, and saving it again keeps them. Enough for the song
  // (8 bytes a sample in stereo), not for its stems (48: memory.js).
  const headerOf = (file) => {
    const bytes = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
    return bytes.indexOf(0) > 0 ? JSON.parse(bytes.subarray(0, bytes.indexOf(0)).toString()) : null;
  };
  // The error line (reportError), emptied first.
  const message = () => js(`message.textContent`);
  const clearMessage = () => js(`message.textContent = ""`);
  await openFile(path.join(FIXTURES, "bars.wav"));
  await clearMessage();
  memory.available = stems.length * 30;
  await setFiles(projectFile);
  state = await waitFor((s) => s.held, 30_000);
  let said = await message();
  check(
    "stems: a project's stems without memory enough aren't brought back, and it says so",
    state.held &&
      !state.ready &&
      state.action === null &&
      /stems weren't brought back: it needs about .* of memory/.test(said),
    JSON.stringify({ state, said }),
  );
  check("stems: …and that isn't an unsaved change", !(await title()).endsWith(" •"), await title());
  memory.available = null;
  const heldFile = path.join(OUTPUT, "projects", "Held.ebee");
  fs.rmSync(heldFile, { force: true });
  projectDialogs.save = heldFile;
  key("S", ["control", "shift"]);
  await sleep(200);
  await js(`saveModeEmbed.click(); saveForm.requestSubmit()`);
  for (let i = 0; i < 100 && !fs.existsSync(heldFile); i++) await sleep(100);
  await sleep(300);
  const heldHeader = headerOf(heldFile);
  check(
    "stems: …saving it again keeps them as they were, and their mix",
    JSON.stringify(heldHeader?.blobs) === JSON.stringify(header?.blobs) &&
      JSON.stringify(heldHeader?.sections?.stems?.stems?.mix) === JSON.stringify(saved?.mix),
    JSON.stringify({ blobs: heldHeader?.blobs, before: header?.blobs }),
  );
  await openFile(path.join(FIXTURES, "bars.wav"));
  await setFiles(heldFile);
  state = await waitFor((s) => s.ready, 30_000);
  check(
    "stems: …and with memory enough, they come back from it",
    state.ready && !state.held && JSON.stringify(state.rows) === JSON.stringify(mixed),
    JSON.stringify(state),
  );

  // Without memory enough to separate: it says so, and nothing starts.
  await openFile(path.join(FIXTURES, "bars.wav"));
  await clearMessage();
  memory.available = 1000;
  await press(".stems-whole");
  await sleep(300);
  state = await section();
  said = await message();
  check(
    "stems: without memory enough, separating says so, and nothing starts",
    state.busy === null &&
      state.action === "Separate the whole song" &&
      /Not enough memory to separate the stems of “bars\.wav”: .* is available/.test(said),
    JSON.stringify({ state, said }),
  );
  // Where what's available can't be told (macOS): by all of it.
  await clearMessage();
  memory.available = undefined;
  memory.total = 1e6;
  await press(".stems-whole");
  await sleep(300);
  state = await section();
  said = await message();
  check(
    "stems: …and where what's available is unknown, by the computer's memory in all",
    state.busy === null && /more than half of this computer's/.test(said),
    JSON.stringify({ state, said }),
  );
  memory.available = null;
  memory.total = null;

  // The loop first, then the rest, nearest it first. Each segment slowed
  // down, so the separation can be seen in the middle.
  setStemDelay(400);
  const app = `Promise.all([import("./src/context.js"), import("./src/features/playback.js")])`;
  await openFile(path.join(FIXTURES, "long-chirp.m4a")); // 90 s: 16 segments
  await js(`${app}.then(([, { setLoopRegion }]) => setLoopRegion({ start: 60, end: 64, enabled: true }))`);
  // Whether the stems cover [from, to) (seconds).
  const covers = (stems, from, to) =>
    Boolean(stems?.covered.some(([a, b]) => a <= from * stems.sampleRate && b >= to * stems.sampleRate));
  const strip = () =>
    js(`document.querySelector("#waveform > div").shadowRoot.querySelectorAll('[part~="stems-covered-part"]').length`);
  await clearToasts();
  await press(".stems-whole");
  state = await waitFor((s) => s.ready, 60_000);
  let partly = await found();
  check(
    "stems: the loop's stems come first, the mixer with them, while the rest is separated",
    state.ready && /Separating the rest/.test(state.busy ?? "") && covers(partly, 60, 64) && !covers(partly, 0, 90),
    JSON.stringify({ busy: state.busy, covered: partly?.covered }),
  );
  check(
    "stems: …with a notification",
    (await toasts()).some((t) => /loop's stems are ready/.test(t.text)),
  );
  check("stems: …and the waveform shows the part done", (await strip()) > 0, await strip());
  const first = partly.covered;
  await sleep(1500);
  partly = await found();
  // One span still, around the loop and longer: its neighbours came next.
  const around = (stems) => stems?.covered.length === 1 && covers(stems, 60, 64);
  check(
    "stems: …then the rest, nearest the loop first",
    around(partly) && partly.covered[0][1] - partly.covered[0][0] > first[0][1] - first[0][0] && !covers(partly, 0, 10),
    JSON.stringify({ first, then: partly?.covered }),
  );
  // Their copies for saving will fail to be made, until this is turned off
  // again: each encode gets a rate whose resampling filter would be too
  // long to allocate, so it fails at once.
  await js(`(() => {
    const post = Worker.prototype.postMessage;
    window.failStemEncodes = true;
    Worker.prototype.postMessage = function (data, transfer) {
      const failing = window.failStemEncodes && data?.type === "encode";
      return post.call(this, failing ? { ...data, sampleRate: 1e13 } : data, transfer);
    };
  })()`);
  await clearMessage();
  await press(".stems-busy button");
  state = await waitFor((s) => s.busy === null, 5000);
  partly = await found();
  check(
    "stems: Stop keeps what's done, and offers the rest",
    state.ready && state.action === "Separate the rest" && covers(partly, 60, 64) && !covers(partly, 0, 90),
    JSON.stringify({ action: state.action, busy: state.busy, covered: partly?.covered }),
  );
  await shot("stems-partly.png");

  // Copies that couldn't be made: a save stops and says so, writing nothing.
  await waitFor((s) => s.preparing === null, 30_000);
  const failedPrepare = await message();
  const unpreparedFile = path.join(OUTPUT, "projects", "Unprepared.ebee");
  fs.rmSync(unpreparedFile, { force: true });
  projectDialogs.save = unpreparedFile;
  await clearMessage();
  key("S", ["control", "shift"]);
  for (let i = 0; i < 50 && !(await js(`saveDialog.open`)); i++) await sleep(100);
  await js(`saveModeLink.click(); saveForm.requestSubmit()`);
  for (let i = 0; i < 100 && !/wasn't saved/.test(await message()); i++) await sleep(100);
  said = await message();
  check(
    "stems: copies for saving that can't be made: a save stops, saying so",
    /couldn't be prepared for saving/.test(failedPrepare) &&
      /wasn't saved/.test(said) &&
      !fs.existsSync(unpreparedFile),
    JSON.stringify({ failedPrepare, said, written: fs.existsSync(unpreparedFile) }),
  );
  await js(`window.failStemEncodes = false`);
  await clearMessage();

  // Saved part done (the stems' copy came back from the failed encodes:
  // the save tries again), and brought back so.
  const partlyFile = path.join(OUTPUT, "projects", "Partly.ebee");
  fs.rmSync(partlyFile, { force: true });
  projectDialogs.save = partlyFile;
  key("S", ["control", "shift"]);
  await sleep(200);
  await js(`saveModeLink.click(); saveForm.requestSubmit()`);
  for (let i = 0; i < 300 && !fs.existsSync(partlyFile); i++) await sleep(100);
  await sleep(300);
  const partlyHeader = fs.existsSync(partlyFile)
    ? JSON.parse(fs.readFileSync(partlyFile).subarray(0, fs.readFileSync(partlyFile).indexOf(0)).toString() || "{}")
    : {};
  const savedCovered = partlyHeader.sections?.stems?.stems?.covered;
  check(
    "stems: a project keeps the parts done",
    JSON.stringify(savedCovered) === JSON.stringify(partly?.covered),
    JSON.stringify({ saved: savedCovered, found: partly?.covered }),
  );
  await openFile(path.join(FIXTURES, "bars.wav"));
  await setFiles(partlyFile);
  state = await waitFor((s) => s.ready, 30_000);
  const reopened = await found();
  check(
    "stems: …and brings them back so, with Separate the rest",
    state.ready &&
      state.action === "Separate the rest" &&
      JSON.stringify(reopened?.covered) === JSON.stringify(savedCovered),
    JSON.stringify({ action: state.action, covered: reopened?.covered }),
  );

  // The loop alone over them, stopped part way: Stop, not Cancel, so the
  // page's copy comes back from the worker, and the rest can carry on.
  await js(`${app}.then(([, { setLoopRegion }]) => setLoopRegion({ start: 10, end: 14, enabled: true }))`);
  setStemDelay(1500);
  await clearMessage();
  await press(".stems-loop");
  await waitFor((s) => /Separating the loop/.test(s.busy ?? ""), 10_000);
  const stopLabel = await js(`document.querySelector("#stemsSection .stems-busy button").textContent`);
  await press(".stems-busy button");
  state = await waitFor((s) => s.busy === null, 5000);
  check(
    "stems: the loop alone over the whole song's stems stops, keeping them",
    stopLabel === "Stop" && state.ready && state.action === "Separate the rest" && covers(await found(), 60, 64),
    JSON.stringify({ stopLabel, action: state.action, busy: state.busy }),
  );
  setStemDelay(400);

  // Carrying on: the rest, until all of it is done.
  await press(".stems-whole");
  state = await waitFor((s) => s.busy !== null, 5000);
  check("stems: Separate the rest carries on, the mixer still there", state.ready, JSON.stringify(state));
  setStemDelay(0);
  state = await waitFor((s) => s.busy === null, 60_000);
  const whole = await found();
  check(
    "stems: …until all of it is done",
    state.ready && state.action === null && covers(whole, 0, 89.9) && (await strip()) === 0,
    JSON.stringify({ action: state.action, covered: whole?.covered }),
  );
  check(
    "stems: …sound throughout",
    whole && Object.values(whole.levels).every(Number.isFinite) && Object.values(whole.levels).some((l) => l > 1e-3),
    JSON.stringify(whole?.levels),
  );
  check("stems: …which is an unsaved change", (await title()).endsWith(" •"), await title());
  await waitFor((s) => s.preparing === null, 60_000);

  // The loop alone: only its part, its stems in a window around it, and
  // it ends there. With memory enough for that but not the whole song, the
  // whole song is refused and the loop alone goes ahead.
  await openFile(path.join(FIXTURES, "long-chirp.m4a"));
  await js(`${app}.then(([, { setLoopRegion }]) => setLoopRegion({ start: 60, end: 64, enabled: true }))`);
  state = await section();
  check(
    "stems: two buttons, the loop alone and the whole song",
    state.loop === "Separate the loop" && state.action === "Separate the whole song",
    JSON.stringify({ loop: state.loop, action: state.action }),
  );
  // What each would need (the loop with its window: 4 + 16 s), and memory between the two.
  const needs = await js(`Promise.all([import("./src/features/stems/memory.js"), import("./src/context.js")])
    .then(([m, { player }]) => {
      const seconds = player.transport.duration;
      return { part: m.partBytes({ seconds: 4 + 16, sampleRate: 48000 }), whole: m.separationBytes({ seconds, sampleRate: 48000 }) };
    })`);
  memory.available = (needs.part + needs.whole) / 2 / 0.8;
  await clearMessage();
  await press(".stems-whole");
  await sleep(300);
  said = await message();
  check(
    "stems: without memory enough for the whole song, it suggests the loop",
    (await section()).busy === null && /separating the loop only, may help/.test(said),
    JSON.stringify({ needs, said }),
  );
  await clearToasts();
  await press(".stems-loop");
  memory.available = null;
  state = await waitFor((s) => s.ready && s.busy === null, 60_000);
  let alone = await found();
  check(
    "stems: …and the loop alone goes ahead: its part, nothing far from it",
    state.ready && covers(alone, 60, 64) && !covers(alone, 40, 64) && !covers(alone, 60, 80),
    JSON.stringify({ busy: state.busy, covered: alone?.covered }),
  );
  check(
    "stems: …held in a window around it",
    alone?.start > 45 * alone.sampleRate && alone.span < 25 * alone.sampleRate && alone.length > 89 * alone.sampleRate,
    JSON.stringify({ start: alone?.start, span: alone?.span, length: alone?.length, rate: alone?.sampleRate }),
  );
  check(
    "stems: …with a notification",
    (await toasts()).some((t) => /loop's stems are ready/.test(t.text)),
  );
  await sleep(1000);
  state = await section();
  check(
    "stems: …and it ends there, offering the whole song, not the loop again",
    JSON.stringify((await found())?.covered) === JSON.stringify(alone.covered) &&
      state.busy === null &&
      state.loop === null &&
      state.action === "Separate the whole song",
    JSON.stringify({ covered: (await found())?.covered, loop: state.loop, action: state.action }),
  );

  // Another loop, alone: it replaces the first.
  await js(`${app}.then(([, { setLoopRegion }]) => setLoopRegion({ start: 20, end: 24, enabled: true }))`);
  state = await section();
  check("stems: a loop not separated offers itself again", state.loop === "Separate the loop", state.loop);
  await press(".stems-loop");
  await waitFor((s) => s.ready && s.busy === null && s.loop === null, 60_000);
  alone = await found();
  check(
    "stems: …and replaces the part before",
    covers(alone, 20, 24) && !covers(alone, 60, 64) && alone.start < 20 * alone.sampleRate,
    JSON.stringify({ start: alone?.start, covered: alone?.covered }),
  );

  // Saved, and brought back as it was.
  await waitFor((s) => s.preparing === null, 60_000);
  const aloneFile = path.join(OUTPUT, "projects", "Alone.ebee");
  fs.rmSync(aloneFile, { force: true });
  projectDialogs.save = aloneFile;
  key("S", ["control", "shift"]);
  await sleep(200);
  await js(`saveModeLink.click(); saveForm.requestSubmit()`);
  for (let i = 0; i < 300 && !fs.existsSync(aloneFile); i++) await sleep(100);
  await sleep(300);
  const aloneSaved = headerOf(aloneFile)?.sections?.stems?.stems;
  check(
    "stems: a project keeps the loop alone's part",
    aloneSaved?.start === alone.start && aloneSaved?.span === alone.span,
    JSON.stringify({ start: aloneSaved?.start, span: aloneSaved?.span }),
  );
  // Its media moved, and another file picked in its place: the stems
  // don't match it, so they're kept as the project has them, unplayed.
  const aloneBytes = fs.readFileSync(aloneFile);
  const aloneEnd = aloneBytes.indexOf(0);
  const relinkedHeader = JSON.parse(aloneBytes.subarray(0, aloneEnd).toString());
  relinkedHeader.media = {
    ...relinkedHeader.media,
    path: "/nowhere/long-chirp.m4a",
    relativePath: "nowhere/long-chirp.m4a",
  };
  const relinkedFile = path.join(OUTPUT, "projects", "Relinked.ebee");
  fs.writeFileSync(
    relinkedFile,
    Buffer.concat([Buffer.from(JSON.stringify(relinkedHeader)), aloneBytes.subarray(aloneEnd)]),
  );
  projectDialogs.locate = path.join(FIXTURES, "bars.wav");
  await clearMessage();
  await setFiles(relinkedFile);
  state = await waitFor((s) => s.held, 30_000);
  said = await message();
  projectDialogs.locate = null;
  const heldNote = await js(`document.querySelector("#stemsSection .stems-held").textContent`);
  check(
    "stems: a project relinked to another file keeps its stems unplayed: they don't match it",
    state.held && !state.ready && /don't match this file/.test(said) && /don't match this file/.test(heldNote),
    JSON.stringify({ held: state.held, ready: state.ready, said, heldNote }),
  );

  await openFile(path.join(FIXTURES, "bars.wav"));
  await setFiles(aloneFile);
  state = await waitFor((s) => s.ready, 30_000);
  const aloneBack = await found();
  check(
    "stems: …and brings it back so",
    aloneBack?.start === alone.start &&
      aloneBack.span === alone.span &&
      JSON.stringify(aloneBack.covered) === JSON.stringify(alone.covered) &&
      state.action === "Separate the whole song",
    JSON.stringify({ found: aloneBack && { ...aloneBack, levels: undefined }, action: state.action }),
  );

  // The whole song after the loop alone, failing to start: the stems are
  // widened to all of it, but their copies for saving still hold the
  // window, and a save says so.
  setStemStartFails(true);
  await clearMessage();
  await press(".stems-whole");
  state = await waitFor((s) => s.busy === null && s.ready, 10_000);
  said = await message();
  setStemStartFails(false);
  check(
    "stems: a whole song that can't start says so, the stems kept",
    state.ready && (await found())?.start === 0 && /can't start/.test(said),
    JSON.stringify({ said, start: (await found())?.start }),
  );
  const widenedFile = path.join(OUTPUT, "projects", "Widened.ebee");
  fs.rmSync(widenedFile, { force: true });
  projectDialogs.save = widenedFile;
  key("S", ["control", "shift"]);
  await sleep(200);
  await js(`saveModeLink.click(); saveForm.requestSubmit()`);
  for (let i = 0; i < 300 && !fs.existsSync(widenedFile); i++) await sleep(100);
  await sleep(300);
  const widenedSaved = headerOf(widenedFile)?.sections?.stems?.stems;
  check(
    "stems: …and saved then, they keep the window's place",
    widenedSaved?.start === alone.start &&
      widenedSaved?.span === alone.span &&
      JSON.stringify(widenedSaved?.covered) === JSON.stringify(alone.covered),
    JSON.stringify({ start: widenedSaved?.start, span: widenedSaved?.span, covered: widenedSaved?.covered }),
  );
  await openFile(path.join(FIXTURES, "bars.wav"));
  await setFiles(widenedFile);
  await waitFor((s) => s.ready, 30_000);
  check("stems: …and come back there", (await found())?.start === alone.start, JSON.stringify((await found())?.start));

  // The whole song after the loop alone: it widens to all of it and carries on.
  await press(".stems-whole");
  state = await waitFor((s) => s.busy === null && s.action === null, 60_000);
  const widened = await found();
  check(
    "stems: the whole song after the loop alone carries on to all of it",
    state.ready && widened?.start === 0 && widened.span === widened.length && covers(widened, 0, 89.9),
    JSON.stringify({ start: widened?.start, span: widened?.span, covered: widened?.covered }),
  );
  await waitFor((s) => s.preparing === null, 60_000);

  // A new file forgets them; Cancel stops a separation.
  await openFile(path.join(FIXTURES, "bars.wav"));
  state = await section();
  check(
    "stems: a new file forgets them",
    !state.ready && state.action === "Separate the whole song",
    JSON.stringify(state),
  );
  check("stems: …and what was found", (await found()) === null);
  await press(".stems-whole");
  await waitFor((s) => s.busy !== null, 5000);
  await press(".stems-busy button");
  state = await waitFor((s) => s.busy === null, 2000);
  check("stems: Cancel stops it", state.action === "Separate the whole song" && !state.ready, JSON.stringify(state));
  await sleep(500);
  state = await section();
  check("stems: …and nothing comes back later", !state.ready && state.busy === null, JSON.stringify(state));

  // The model's file gone while EarBee runs: a start fails, and the next
  // try downloads it again (here it can't be: the test's server has none).
  setStemModelGone(true);
  await clearMessage();
  await press(".stems-whole");
  for (let i = 0; i < 100 && !(await message()); i++) await sleep(100);
  const gone = await message();
  await clearMessage();
  await press(".stems-whole");
  for (let i = 0; i < 100 && !(await message()); i++) await sleep(100);
  said = await message();
  setStemModelGone(false);
  check(
    "stems: the model's file gone: a start fails, and the next try downloads it again",
    /isn't there yet/.test(gone) && /Couldn't download the stem model/.test(said),
    JSON.stringify({ gone, said }),
  );
};
