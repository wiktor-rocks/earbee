// Finding the beats (B or the ♩ chip): the lines over the waveform, the
// tempo, ← / → stepping by beats, showing and hiding the lines, and a new
// file forgetting them. Part of the end-to-end run (see run.cjs); `h` is
// the harness.
const path = require("path");

module.exports = async function (h) {
  const { js, key, click, pos, slide, openFile, ensurePaused, check, sleep, FIXTURES } = h;

  const chip = () =>
    js(
      `(() => { const e = document.getElementById("beatInfo"); return { hidden: e.hidden, text: e.textContent, disabled: e.classList.contains("disabled") }; })()`,
    );
  const lines = () => js(`document.querySelectorAll(".guide-beat").length`);
  const stepText = () => js(`document.getElementById("stepSize").textContent.trim()`);
  // Waits for the chip to stop saying it's finding the beats.
  async function found() {
    for (let i = 0; i < 200 && (await chip()).text.includes("Finding"); i++) await sleep(50);
    return chip();
  }

  // The clicks are every 0.5 s from 0.25 s: 120 BPM.
  await openFile(path.join(FIXTURES, "clicks.wav"));
  await ensurePaused();
  let c = await chip();
  check("the ♩ chip offers to find the beats", !c.hidden && c.text === "♩ Find the beats", JSON.stringify(c));
  check("no beat lines yet", (await lines()) === 0);

  key("B");
  c = await found();
  check("B finds 120 BPM", c.text === "♩ 120 BPM", JSON.stringify(c));
  const count = await lines();
  check("beat lines over the waveform", count >= 35 && count <= 40, count);
  check("the step becomes 1 beat", (await stepText()) === "Step 1 beat", await stepText());

  await click(5.1);
  await sleep(100);
  key("Right");
  await sleep(100);
  let p = await pos();
  check("→ goes to the next beat", Math.abs(p - 5.25) < 0.015, p);
  key("Right");
  await sleep(100);
  p = await pos();
  check("→ again: the one after", Math.abs(p - 5.75) < 0.015, p);
  key("Left");
  key("Left");
  await sleep(100);
  p = await pos();
  check("← ← go back two beats", Math.abs(p - 4.75) < 0.015, p);

  key("Down");
  await sleep(50);
  check("↓ picks a seconds step", (await stepText()).endsWith(" s"), await stepText());
  key("Up");
  await sleep(50);
  check("↑ comes back to 1 beat", (await stepText()) === "Step 1 beat", await stepText());

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
