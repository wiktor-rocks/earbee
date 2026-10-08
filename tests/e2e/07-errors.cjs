// Errors versus notices; a bad file keeps the previous one (loop and
// settings); a file that opens resets the sound settings.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const fs = require("fs");
const path = require("path");

module.exports = async function (h) {
  const { js, openFile, shot, loopInfo, key, check, sleep, FIXTURES } = h;

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
};
