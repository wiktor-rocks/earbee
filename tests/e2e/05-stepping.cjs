// Arrow-key stepping, step sizes, sliders and keyboard focus.
// Part of the end-to-end run (see run.cjs); `h` is the harness.

module.exports = async function (h) {
  const { wc, js, key, click, pos, sample, firstMoved, ensurePaused, check, sleep } = h;
  let p, s;

  const stepText = () =>
    js(`["stepSize", "stepBack", "stepForward"].map((id) => document.getElementById(id).textContent.trim()).join("|")`);
  check(
    "default step 1 s, arrow buttons",
    (await stepText()) === "Step 1 s||" &&
      (await js(`!!document.querySelector("#stepBack svg") && !!document.querySelector("#stepForward svg")`)),
    await stepText(),
  );
  await click(5);
  let p0 = await pos();
  key("Right");
  await sleep(100);
  check("→ steps forward 1 s", Math.abs((await pos()) - p0 - 1) < 0.002, await pos());
  key("Left");
  await sleep(100);
  check("← steps back 1 s", Math.abs((await pos()) - p0) < 0.002, await pos());
  key("Down");
  key("Down");
  await sleep(100);
  check("↓↓ gives 0.25 s step, buttons unlabelled", (await stepText()) === "Step 0.25 s||", await stepText());
  key("Right");
  await sleep(100);
  check("→ steps 0.25 s", Math.abs((await pos()) - p0 - 0.25) < 0.002, await pos());
  for (let i = 0; i < 10; i++) key("Down");
  await sleep(100);
  check("step stops at 0.01", (await stepText()).startsWith("Step 0.01 s"), await stepText());
  for (let i = 0; i < 10; i++) key("Up");
  await sleep(100);
  check("step stops at 10", (await stepText()).startsWith("Step 10 s"), await stepText());
  // A click on the step size picks the next one, round from the end;
  // Shift+click the one before.
  await js(`stepSize.click()`);
  await sleep(50);
  check("a click on the step size goes round to 0.01", (await stepText()).startsWith("Step 0.01 s"), await stepText());
  await js(`stepSize.click()`);
  await sleep(50);
  check("…and on to 0.05", (await stepText()).startsWith("Step 0.05 s"), await stepText());
  await js(`for (let i = 0; i < 2; i++) stepSize.dispatchEvent(new MouseEvent("click", { shiftKey: true }))`);
  await sleep(50);
  check("Shift+click goes back, round to 10", (await stepText()).startsWith("Step 10 s"), await stepText());
  for (let i = 0; i < 4; i++) key("Down");
  await sleep(100); // back to 0.5
  check("back to 0.5", (await stepText()).startsWith("Step 0.5 s"), await stepText());
  await click(2);
  p0 = await pos();
  wc.sendInputEvent({ type: "keyDown", keyCode: "Right" });
  for (let i = 0; i < 4; i++) wc.sendInputEvent({ type: "keyDown", keyCode: "Right", modifiers: ["isAutoRepeat"] });
  wc.sendInputEvent({ type: "keyUp", keyCode: "Right" });
  await sleep(150);
  check("holding → repeats", Math.abs((await pos()) - p0 - 2.5) < 0.002, `${p0} → ${await pos()}`);
  wc.sendInputEvent({ type: "keyDown", keyCode: "Up" });
  for (let i = 0; i < 4; i++) wc.sendInputEvent({ type: "keyDown", keyCode: "Up", modifiers: ["isAutoRepeat"] });
  wc.sendInputEvent({ type: "keyUp", keyCode: "Up" });
  await sleep(100);
  check("holding ↑ changes step once", (await stepText()).startsWith("Step 1 s"), await stepText());
  p0 = await pos();
  key("C"); // R used to skip back with C; R now marks regions (14-marks)
  await sleep(100);
  check("C does nothing", (await pos()) === p0);
  const legend = await js(`document.getElementById("shortcutList").textContent`);
  check(
    "legend shows arrows, no R/C",
    legend.includes("←Step back") && legend.includes("↓Smaller step") && !legend.includes("Skip"),
    legend,
  );
  // Clicked slider: arrows still step the cursor
  const sl = await js(
    `(() => { const r = document.getElementById("speed").closest(".knob").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
  );
  wc.sendInputEvent({ type: "mouseDown", x: sl.x, y: sl.y, button: "left", clickCount: 1 });
  wc.sendInputEvent({ type: "mouseUp", x: sl.x, y: sl.y, button: "left", clickCount: 1 });
  await sleep(100);
  const speedBefore = await js(`document.getElementById("speed").value`);
  p0 = await pos();
  check("a clicked slider gives its focus back", await js(`document.activeElement === document.body`));
  key("Right");
  await sleep(100);
  check(
    "clicked slider: → steps cursor, speed unchanged",
    (await js(`document.getElementById("speed").value`)) === speedBefore && Math.abs((await pos()) - p0 - 1) < 0.002,
    `${speedBefore} ${p0}→${await pos()}`,
  );
  // Tab-focused slider keeps arrows
  await js(`document.getElementById("speed").blur(); document.getElementById("stepForward").focus()`);
  for (let i = 0; i < 15 && !(await js(`document.activeElement.id === "speed"`)); i++) {
    key("Tab");
    await sleep(30);
  }
  const fv = await js(`document.getElementById("speed").matches(":focus-visible")`);
  p0 = await pos();
  const v0 = await js(`document.getElementById("speed").value`);
  key("Right");
  await sleep(100);
  const v1 = await js(`document.getElementById("speed").value`);
  check("Tab-focused slider keeps arrows", v1 !== v0 && (await pos()) === p0, `focus-visible=${fv} ${v0}→${v1}`);
  await js(`document.querySelector('#speedChips [data-speed="1"]').click(); document.activeElement.blur()`);

  // The speed knob: a drag up turns it up (800 px for the whole range,
  // CONFIG.knob), with Shift 5× less; the wheel with Shift by one step;
  // a double-clicked value can be typed.
  await h.shot("dock-knobs.png");
  await js(`eqToggle.click(); eqPopover.showPopover()`);
  await h.shot("dock-eq-knobs.png");
  await js(`eqPopover.hidePopover(); eqToggle.click()`);
  const speedNow = async () => Number(await js(`document.getElementById("speed").value`));
  const dragKnob = async (dy, modifiers = []) => {
    wc.sendInputEvent({ type: "mouseDown", x: sl.x, y: sl.y, button: "left", clickCount: 1, modifiers });
    for (let i = 1; i <= 10; i++) {
      wc.sendInputEvent({ type: "mouseMove", x: sl.x, y: sl.y - (dy * i) / 10, button: "left", modifiers });
      await sleep(15);
    }
    wc.sendInputEvent({ type: "mouseUp", x: sl.x, y: sl.y - dy, button: "left", clickCount: 1, modifiers });
    await sleep(100);
  };
  let k0 = await speedNow();
  await dragKnob(50);
  const coarse = (await speedNow()) - k0;
  check("dragging the knob up turns it up", Math.abs(coarse - 0.18) < 0.015, `${k0}→${await speedNow()}`);
  k0 = await speedNow();
  await dragKnob(-50, ["shift"]);
  const fine = k0 - (await speedNow());
  check("Shift turns it 5× finer", Math.abs(fine - 0.04) < 0.015, `${k0}→${await speedNow()}`);
  // Settings › General › Knob sensitivity: at 200 % the same drag turns it twice as far.
  await js(`earbee.prefs.set("general", "knobSensitivity", 200)`);
  await sleep(100);
  k0 = await speedNow();
  await dragKnob(50);
  const doubled = (await speedNow()) - k0;
  check("Knob sensitivity 200 %: twice as far", Math.abs(doubled - 0.37) < 0.02, `${k0}→${await speedNow()}`);
  await js(`earbee.prefs.set("general", "knobSensitivity", 100)`);
  await sleep(100);
  k0 = await speedNow();
  wc.sendInputEvent({ type: "mouseWheel", x: sl.x, y: sl.y, deltaX: 0, deltaY: 100, modifiers: ["shift"] });
  await sleep(100);
  check("Shift+wheel up: one step", Math.abs((await speedNow()) - k0 - 0.01) < 1e-6, `${k0}→${await speedNow()}`);
  await js(`speedValue.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
  await sleep(50);
  check("double-clicking the value gives a field", await js(`document.activeElement.matches(".knob-value-field")`));
  await js(`document.activeElement.value = "0.63"`);
  key("Return");
  await sleep(100);
  check(
    "a typed value sets the speed",
    (await speedNow()) === 0.63 &&
      (await js(`speedValue.textContent`)) === "0.63×" &&
      (await js(`!document.querySelector(".knob-value-field")`)),
    `${await speedNow()} ${await js(`speedValue.textContent`)}`,
  );
  await js(`document.querySelector('#speedChips [data-speed="1"]').click(); document.activeElement.blur()`);
  // Loop interplay and Space after stepping
  await click(5);
  key("[");
  await click(6);
  key("]");
  await sleep(100);
  await click(5.8);
  key("Space");
  await sleep(100);
  key("Right");
  await sleep(200);
  p = await pos();
  await ensurePaused();
  // A step is a jump like a click: past B, playback runs on from there.
  check("stepping past B while looping plays on from there", p > 6.8 && p < 7.3, p);
  key("L", ["shift"]);
  await click(10);
  key("Right");
  await sleep(100);
  key("Space");
  s = await sample(300);
  await ensurePaused();
  check(
    "step while paused, Space plays from stepped spot",
    Math.abs(firstMoved(s, 11) - 11) < 0.06 || Math.abs(s[0].pos - 11) < 0.06,
    s.slice(0, 3).map((q) => q.pos),
  );
};
