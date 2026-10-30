// Static UI and offline: the dock's knobs, bundled fonts, the shortcuts list.
// Part of the end-to-end run (see run.cjs); `h` is the harness.

module.exports = async function (h) {
  const { js, check } = h;

  // The dock: a knob over every setting's slider (the EQ bands' in a popover),
  // and the speed presets (a few next to the knob, all behind "…").
  check(
    "every slider has a knob",
    await js(
      `["speed", "volume", "semitoneShift", "centShift", "eqLow", "eqLowMid", "eqMid", "eqHighMid", "eqHigh", "eqFocusLow", "eqFocusHigh"].every((id) => document.getElementById(id).parentElement.matches(".knob"))`,
    ),
  );
  check(
    "the EQ bands are knobs in their popover",
    (await js(`eqPopover.querySelectorAll("#eqKnobs .knob").length`)) === 5,
  );
  check(
    "the Focus: Off and a chip per preset, two knobs, off to start with",
    (await js(
      `[eqFocusChips.children.length, eqFocusKnobs.querySelectorAll(".knob").length, eqFocusSummary.hidden, eqFocusChips.querySelector(".active")?.dataset.focus].join()`,
    )) === "9,2,true,off",
  );

  // A preset keeps its range and turns the EQ on; the side panel names it.
  // One end pushes the other along; Off cuts nothing again.
  const focus = () =>
    js(
      `[eqFocusLowValue.textContent, eqFocusHighValue.textContent, eqToggle.textContent, eqFocusSummary.hidden ? "" : eqFocusSummary.textContent, eqFocusChips.querySelector(".active")?.dataset.focus ?? "custom"].join()`,
    );
  await js(`eqFocusChips.querySelector('[data-focus="bass"]').click()`);
  check(
    "a Focus preset: its notes, the EQ on, its name in the side panel",
    (await focus()) === "B0,C5,On,Bass guitar · B0–C5,bass",
    await focus(),
  );
  await js(
    `(() => { const input = document.getElementById("eqFocusLow"); input.value = "79"; input.dispatchEvent(new Event("input")); })()`,
  );
  check(
    "the lowest note past the highest pushes it along: a custom range",
    (await focus()) === "G5,G5,On,Custom · G5–G5,custom",
    await focus(),
  );
  await js(`eqFocusChips.querySelector('[data-focus="off"]').click(); eqToggle.click()`);
  check("Off: the whole range, nothing named", (await focus()) === "A0,C8,Off,,off", await focus());

  check(
    "speed presets: 3 in the dock, 12 behind …",
    (await js(`[speedChips.children.length, speedChipsAll.children.length].join()`)) === "3,12",
  );
  await js(`document.fonts.ready`);
  check(
    "Nunito loaded offline",
    (await js(`document.fonts.check('16px "Nunito Variable"')`)) &&
      (await js(`[...document.fonts].some(f => f.family.includes("Nunito") && f.status === "loaded")`)),
  );
  check(
    "Righteous loaded offline",
    await js(`[...document.fonts].some(f => f.family.includes("Righteous") && f.status === "loaded")`),
  );
  check(
    "legend has Shift+L",
    (await js(`document.getElementById("shortcutList").textContent`)).includes("Shift+LClear loop"),
  );

  // The shortcuts are listed by group, in a dialog that starts closed
  // (opening it is checked in 14-marks, once the player is on screen).
  check(
    "the shortcuts are grouped",
    (await js(`[...document.querySelectorAll("#shortcutList h3")].map((h) => h.textContent).join("|")`)) ===
      "File|Playback|Moving around|A–B loop|Marks|Video|Help", // Video window (src/features/video-window/): "Video"
  );
  check("the shortcuts dialog starts closed", !(await js(`shortcutsDialog.open`)));
  // Nothing can be highlighted, except text in fields being edited.
  check(
    "no text selection, except in text fields",
    await js(`(() => {
      const select = (el) => getComputedStyle(el).userSelect;
      return [document.body, document.querySelector(".welcome-title"), document.getElementById("trackTime")].every((el) => select(el) === "none") &&
        select(document.getElementById("downloadUrl")) === "text";
    })()`),
  );
};
