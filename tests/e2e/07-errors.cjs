// Errors versus notices; a bad file keeps the previous one (loop and
// settings); a file that opens resets the sound settings. Loading: the
// audio runs at the file's own rate, progress and Cancel, a track too
// long for the available memory, a file without sound.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const fs = require("fs");
const path = require("path");

module.exports = async function (h) {
  const { js, dbg, openFile, shot, loopInfo, key, pos, ensurePaused, memory, check, sleep, FIXTURES } = h;

  // What the sound settings show, and changing them as a user would.
  const settings = () =>
    js(
      `({ speed: speedValue.textContent, volume: volumeValue.textContent, semitones: semitoneValue.textContent, cents: centValue.textContent, eqLow: eqLowValue.textContent, eq: eqToggle.textContent, step: stepSize.textContent })`,
    );
  const slide = (id, value) =>
    js(
      `(() => { const s = document.getElementById("${id}"); s.value = "${value}"; s.dispatchEvent(new Event("input")); })()`,
    );
  const defaults = await settings();
  await slide("speed", 0.5);
  await slide("volume", 150);
  await slide("semitoneShift", -3);
  await slide("centShift", 20);
  await slide("eqLow", 6);
  await js(`eqToggle.click()`);
  key("Up"); // a larger step size
  await sleep(150);
  const changed = await settings();

  fs.writeFileSync(path.join(FIXTURES, "bad.mp3"), "not audio");
  await openFile(path.join(FIXTURES, "bad.mp3"));
  const msg = await js(
    `(() => { const e = document.getElementById("message"); return { text: e.textContent, notice: e.classList.contains("notice"), color: getComputedStyle(e).color }; })()`,
  );
  check(
    "bad file after first load: red error in player",
    msg.text.includes("Couldn't open") && !msg.notice,
    JSON.stringify(msg),
  );
  check("bad file keeps loop of previous song", !(await loopInfo()).hidden);
  check(
    "bad file keeps the sound settings",
    JSON.stringify(await settings()) === JSON.stringify(changed) && changed.speed !== defaults.speed,
    JSON.stringify(changed),
  );
  await shot("error.png");

  // A file that opens: speed, pitch, volume and EQ back to the defaults;
  // the step size stays.
  await openFile(path.join(FIXTURES, "tone.wav"));
  const after = await settings();
  check(
    "a new file resets speed, pitch, volume and EQ",
    ["speed", "volume", "semitones", "cents", "eqLow", "eq"].every((name) => after[name] === defaults[name]),
    JSON.stringify(after),
  );
  check("a new file keeps the step size", after.step === changed.step && after.step !== defaults.step, after.step);
  check(
    "the reset reaches the controls (speed slider and chip)",
    await js(`speed.value === "1" && document.querySelector(".chip.active")?.dataset.speed === "1"`),
  );

  // The track plays in an AudioContext at its own rate (44.1 kHz here),
  // and at 1×: the position advances a second per second.
  check("the audio runs at the file's rate (44.1 kHz)", (await js(`__contexts.at(-1).sampleRate`)) === 44100);
  {
    await js(`document.getElementById("play").click()`);
    await sleep(300);
    const from = await pos();
    await sleep(1500);
    const advanced = (await pos()) - from;
    await ensurePaused();
    check("44.1 kHz file plays at 1×", Math.abs(advanced - 1.5) < 0.15, `advanced ${advanced.toFixed(3)} s in 1.5 s`);
  }

  const state = () =>
    js(
      `({ file: fileName.textContent, speed: speedValue.textContent, message: message.textContent, overlay: !loadingOverlay.hidden, status: overlayStatus.textContent, cancel: !overlayCancel.hidden, ready: !play.disabled, workers: __workers.live() })`,
    );
  async function waitForOverlay() {
    for (let i = 0; i < 100 && (await state()).overlay; i++) await sleep(50);
  }
  async function setFile(file) {
    const { root } = await dbg.sendCommand("DOM.getDocument");
    const { nodeId } = await dbg.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector: "#file" });
    await dbg.sendCommand("DOM.setFileInputFiles", { nodeId, files: [file] });
  }

  // Cancel during a (slowed) load: the current file stays, with its settings.
  await slide("speed", 0.5);
  await js(`window.__slowDecode = 1500`);
  await setFile(path.join(FIXTURES, "counter.webm"));
  await sleep(400);
  let during = await state();
  check(
    "loading shows its progress and Cancel",
    during.overlay && /^Loading \d+ %$/.test(during.status) && during.cancel,
    JSON.stringify(during),
  );
  await js(`overlayCancel.click()`);
  await waitForOverlay();
  await js(`window.__slowDecode = 0`);
  let after2 = await state();
  check(
    "Cancel keeps the current file and its settings, without an error",
    after2.file === "tone.wav" && after2.speed === "0.50×" && after2.message === "" && after2.ready,
    JSON.stringify(after2),
  );
  check("Cancel stops the decoder", after2.workers === 0, `live workers: ${after2.workers}`);

  // Too long for the available memory: refused before decoding.
  memory.available = 1000;
  await openFile(path.join(FIXTURES, "counter.webm"));
  memory.available = null;
  after2 = await state();
  check(
    "a track too big for the memory is refused, the current file stays",
    after2.message.includes("is too long to open") &&
      after2.message.includes("available") &&
      after2.file === "tone.wav",
    JSON.stringify(after2),
  );

  // A video without sound.
  await openFile(path.join(FIXTURES, "dl-video.webm"));
  after2 = await state();
  check(
    "a file without sound says so",
    after2.message.includes("has no sound") && after2.file === "tone.wav",
    JSON.stringify(after2),
  );
  await slide("speed", 1);
};
