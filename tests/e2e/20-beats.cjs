// Finding the beats (B or the ♩ chip): by the beat model, the lines over
// the waveform (the first of each bar stronger), the tempo, ← / →
// stepping by beats and by bars, showing and hiding the lines, the beat
// click (Shift+B), the simple finder when the model can't run, and a new
// file forgetting them. Part of the end-to-end run (see run.cjs); `h` is
// the harness.
const path = require("path");
const { ipcMain, utilityProcess } = require("electron");

module.exports = async function (h) {
  const {
    js,
    key,
    click,
    pos,
    slide,
    openFile,
    ensurePaused,
    check,
    sleep,
    toasts,
    clearToasts,
    prefsStore,
    FIXTURES,
  } = h;

  const chip = () =>
    js(
      `(() => { const e = document.getElementById("beatInfo"); return { hidden: e.hidden, text: e.textContent, title: e.title, disabled: e.classList.contains("disabled") }; })()`,
    );
  const lines = () => js(`document.querySelectorAll(".guide-beat").length`);
  const downbeatTimes = async () => {
    const duration = await h.duration();
    const lefts = await js(
      `[...document.querySelectorAll(".guide-beat.downbeat")].map((e) => parseFloat(e.style.left))`,
    );
    return lefts.map((percent) => (percent / 100) * duration);
  };
  const stepText = () => js(`document.getElementById("stepSize").textContent.trim()`);
  // Waits for the chip to stop showing progress: all of the track is done.
  async function found() {
    for (let i = 0; i < 400 && /Finding|%/.test((await chip()).text); i++) await sleep(50);
    return chip();
  }
  const near = (value, target, within = 0.025) => Math.abs(value - target) <= within;

  // bars.wav: a beat every 0.5 s from 0.25 s (120 BPM), the 1 of each bar
  // every 2 s. The model's frames are 20 ms, so its beats are within one.
  await openFile(path.join(FIXTURES, "bars.wav"));
  await ensurePaused();
  let c = await chip();
  check("the ♩ chip offers to find the beats", !c.hidden && c.text === "♩ Find the beats", JSON.stringify(c));
  check("no beat lines yet", (await lines()) === 0);

  key("B");
  c = await found();
  check("B finds 120 BPM", c.text === "♩ 120 BPM", JSON.stringify(c));
  check("…by the beat model", c.title.includes("Found by the beat model"), c.title);
  const count = await lines();
  check("a line for each beat", count >= 39 && count <= 41, count);
  const bars = await downbeatTimes();
  check(
    "the first of each bar stronger, every 2 s",
    bars.length >= 9 && bars.every((time) => near((time - 0.25) % 2, 0) || near((time - 0.25) % 2, 2)),
    JSON.stringify(bars.map((time) => time.toFixed(2))),
  );
  check("the step becomes 1 beat", (await stepText()) === "Step 1 beat", await stepText());

  await click(5.1);
  await sleep(100);
  key("Right");
  await sleep(100);
  let p = await pos();
  check("→ goes to the next beat", near(p, 5.25), p);
  key("Right");
  await sleep(100);
  p = await pos();
  check("→ again: the one after", near(p, 5.75), p);
  key("Left");
  key("Left");
  await sleep(100);
  p = await pos();
  check("← ← go back two beats", near(p, 4.75), p);

  key("Down");
  await sleep(50);
  check("↓ picks a seconds step", (await stepText()).endsWith(" s"), await stepText());
  key("Up");
  await sleep(50);
  check("↑ comes back to 1 beat", (await stepText()) === "Step 1 beat", await stepText());
  // From "1 beat" (0.5 s): 1 s, 2 s, then "1 bar" (2 s, after the 2 s size).
  for (let i = 0; i < 3; i++) key("Up");
  await sleep(50);
  check("↑ reaches 1 bar", (await stepText()) === "Step 1 bar", await stepText());
  key("Right");
  await sleep(100);
  p = await pos();
  check("→ goes to the next bar's first beat", near(p, 6.25), p);
  key("Left");
  await sleep(100);
  p = await pos();
  check("← goes back a bar", near(p, 4.25), p);
  for (let i = 0; i < 3; i++) key("Down");
  await sleep(50);

  await slide("speed", 0.5);
  await sleep(50);
  c = await chip();
  check("the chip shows the tempo heard at 0.5×", c.text === "♩ 120 BPM · 60 at 0.50×", JSON.stringify(c));
  await slide("speed", 1);

  key("B");
  await sleep(50);
  c = await chip();
  check("B again hides the lines, chip dimmed", (await lines()) === 0 && c.disabled, JSON.stringify(c));
  await js(`document.getElementById("beatInfo").click()`);
  await sleep(50);
  check("a click on the chip shows them again", (await lines()) === count && !(await chip()).disabled);

  // Shift+B: the beat click (Settings › General) on, through a short play, and off.
  await clearToasts();
  key("B", ["shift"]);
  await sleep(200);
  check(
    "Shift+B turns the beat click on",
    prefsStore.get("general").beatClick === true && (await toasts()).some((t) => t.text === "Beat click on"),
    JSON.stringify(await toasts()),
  );
  key(",");
  await sleep(600);
  await ensurePaused();
  key("B", ["shift"]);
  await sleep(200);
  check("Shift+B again turns it off", prefsStore.get("general").beatClick === false);
  await clearToasts();

  // When the model can't run, the simple beat finder's beats are used (no bars).
  ipcMain.removeHandler("beats:window");
  ipcMain.handle("beats:window", () => ({ ok: false, error: "no model in this test" }));
  await openFile(path.join(FIXTURES, "clicks.wav"));
  key("B");
  c = await found();
  check("without the model: the simple finder's 120 BPM", c.text === "♩ 120 BPM", JSON.stringify(c));
  check("…said in the tooltip", c.title.includes("simple beat finder"), c.title);
  check("…and no bars", (await downbeatTimes()).length === 0);
  ipcMain.removeHandler("beats:window");
  require(path.join(__dirname, "..", "..", "electron", "beat-model.js")).handleBeatModel(ipcMain, { utilityProcess });

  // A steady tone has no beat; a new file forgets the old one's.
  await openFile(path.join(FIXTURES, "tone.wav"));
  c = await chip();
  check(
    "a new file: no lines, the chip offers again",
    (await lines()) === 0 && c.text === "♩ Find the beats",
    JSON.stringify(c),
  );
  check("…and the step is back to 1 s", (await stepText()) === "Step 1 s", await stepText());
  key("B");
  c = await found();
  check("a steady tone has no steady beat", c.text === "♩ No steady beat", JSON.stringify(c));
  check("…and the step stays in seconds", (await stepText()) === "Step 1 s", await stepText());
  await js(`document.getElementById("message").textContent = ""`);
};
