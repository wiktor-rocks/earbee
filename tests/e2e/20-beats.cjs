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
    drag,
    loopRange,
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

  // Looping by bars (\\, = -, Shift+] Shift+[) and snapping to beats.
  const loopIs = async (start, end) => {
    const loop = await loopRange();
    return loop !== null && loop.enabled && near(loop.start, start, 0.002) && near(loop.end, end, 0.002);
  };
  await click(5.1);
  await sleep(100);
  key("\\");
  await sleep(100);
  check("\\ loops the bar the cursor is in", await loopIs(4.26, 6.26), JSON.stringify(await loopRange()));
  key("=");
  await sleep(100);
  check("= doubles it to two bars", await loopIs(4.26, 8.26), JSON.stringify(await loopRange()));
  key("-");
  await sleep(100);
  check("- halves it back to one", await loopIs(4.26, 6.26), JSON.stringify(await loopRange()));
  key("-");
  await sleep(100);
  check("- again: half a bar, by its beats", await loopIs(4.26, 5.26), JSON.stringify(await loopRange()));
  key("]", ["shift"]);
  await sleep(150);
  check("Shift+] moves on to the next phrase", await loopIs(5.26, 6.26), JSON.stringify(await loopRange()));
  check("…and the cursor to its start", near(await pos(), 5.26, 0.002), await pos());
  key("[", ["shift"]);
  await sleep(150);
  check("Shift+[ moves back", await loopIs(4.26, 5.26), JSON.stringify(await loopRange()));

  await drag(4.32, 6.18, ["shift"]);
  check("a Shift+drag near the beats snaps onto them", await loopIs(4.26, 6.26), JSON.stringify(await loopRange()));
  await drag(4.36, 6.14, ["shift", "alt"]);
  let loop = await loopRange();
  check(
    "…with Alt it doesn't",
    near(loop.start, 4.36, 0.03) && !near(loop.start, 4.26, 0.01) && !near(loop.end, 6.26, 0.01),
    JSON.stringify(loop),
  );
  await click(5.32);
  key("[");
  await sleep(100);
  check(
    "[ just after a beat starts the loop on it",
    near((await loopRange()).start, 5.26, 0.002),
    JSON.stringify(await loopRange()),
  );
  await click(5.5);
  key("[");
  await sleep(100);
  check(
    "[ off the beat stays where it is",
    near((await loopRange()).start, 5.5, 0.03),
    JSON.stringify(await loopRange()),
  );
  await click(7.31);
  key("M");
  await sleep(100);
  const markTimes = () => js(`document.getElementById("marksList").textContent`);
  check("M near a beat puts the mark on it", (await markTimes()).includes("0:07.260"), await markTimes());
  key("Delete");
  key("B"); // hide the lines: no snapping
  await sleep(50);
  await click(5.32);
  key("[");
  await sleep(100);
  loop = await loopRange();
  check("with the lines hidden, nothing snaps", !near(loop.start, 5.26, 0.01), JSON.stringify(loop));
  key("B");
  key("L", ["shift"]);
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
  key("B");
  await sleep(50);
  check("B shows them again", (await lines()) === count && !(await chip()).disabled);

  // The beats menu (a click on the chip, once found): the lines, the
  // click, and this project's edits to the beats.
  const menuOpen = () => js(`document.getElementById("beatMenu").matches(":popover-open")`);
  const pick = async (selector) => {
    await js(`document.querySelector('#beatMenu ${selector}').click()`);
    await sleep(100);
  };
  const ticked = (selector) => js(`document.querySelector('#beatMenu ${selector}').getAttribute("aria-checked")`);
  const subdivisionLines = () => js(`document.querySelectorAll(".guide-beat.subdivision").length`);
  await js(`document.getElementById("beatInfo").click()`);
  await sleep(100);
  check("a click on the chip opens the beats menu", await menuOpen());
  check(
    "…with the lines shown, bars and the steady grid on, no click",
    (await ticked("[data-shown]")) === "true" &&
      (await ticked("[data-bars]")) === "true" &&
      (await ticked("[data-steady]")) === "true" &&
      (await ticked("[data-click]")) === "false",
  );
  await pick("[data-shown]");
  check("Show the beat lines: off hides them", (await lines()) === 0 && (await chip()).disabled);
  await pick("[data-shown]");
  check("…on shows them", (await lines()) === count);
  await pick("[data-click]");
  check("Click on each beat: turns the beat click on", prefsStore.get("general").beatClick === true);
  check("…ticked", (await ticked("[data-click]")) === "true");
  await pick("[data-click]");
  check("…and off", prefsStore.get("general").beatClick === false);
  await pick("[data-bars]");
  check(
    "Strong first beat off: no bar lines, all beats alike",
    (await downbeatTimes()).length === 0 && (await lines()) === count,
  );
  check("…and nothing to move bars by", await js(`document.querySelector('#beatMenu [data-bar-shift]').hidden`));
  await pick("[data-bars]");
  check("…on again: the bars are back", (await downbeatTimes()).length === bars.length);
  await pick('[data-tempo="0.5"]');
  c = await chip();
  check("Half time: 60 BPM", c.text === "♩ 60 BPM", JSON.stringify(c));
  check("…half the lines", Math.abs((await lines()) - count / 2) <= 1, await lines());
  check("…ticked, and the menu stays open", (await ticked('[data-tempo="0.5"]')) === "true" && (await menuOpen()));
  await pick('[data-tempo="0.5"]');
  check("Half time again: back to 120 BPM", (await chip()).text === "♩ 120 BPM", (await chip()).text);
  await pick('[data-tempo="2"]');
  check("Double time: 240 BPM", (await chip()).text === "♩ 240 BPM", (await chip()).text);
  await pick('[data-tempo="2"]');
  await pick('[data-bar-shift="1"]');
  const later = await downbeatTimes();
  check(
    "Bars start a beat later",
    later.length >= 9 && later.every((time) => near((time - 0.75) % 2, 0) || near((time - 0.75) % 2, 2)),
    JSON.stringify(later.map((time) => time.toFixed(2))),
  );
  await pick('[data-bar-shift="-1"]');
  check("…and earlier again", near((await downbeatTimes())[0], bars[0]), JSON.stringify(await downbeatTimes()));
  await pick('[data-subdivide="2"]');
  check("Halves: a line between each two beats", Math.abs((await subdivisionLines()) - (count - 1)) <= 1);
  check(
    "…ticked",
    (await ticked('[data-subdivide="2"]')) === "true" && (await ticked('[data-subdivide="1"]')) === "false",
  );
  key("Escape");
  await sleep(100);
  check("Escape closes the menu", !(await menuOpen()));
  await drag(4.48, 6.03, ["shift"]);
  check("a Shift+drag snaps onto subdivisions too", await loopIs(4.51, 6.01), JSON.stringify(await loopRange()));
  key("L", ["shift"]);
  await js(`document.getElementById("beatInfo").click()`);
  await sleep(100);
  await pick('[data-subdivide="1"]');
  check("No subdivisions: their lines go", (await subdivisionLines()) === 0);
  key("Escape");
  await sleep(100);

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
  await clearToasts();
  key("\\");
  await sleep(150);
  check(
    "\\ without beats asks for them",
    (await toasts()).some((t) => t.text === "Find the beats first (B).") && (await loopRange()) === null,
    JSON.stringify(await toasts()),
  );
  await clearToasts();
};
