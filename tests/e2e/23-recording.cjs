// Recording (src/features/recording/): the sound input recorded while the
// track plays, cut into takes (one per time around the loop), and the
// take's line in the Mixer. The input is Chromium's stand-in (harness.cjs,
// prepare), so it needs no microphone; what a take sounds like, and whether
// it sits where it was played, is for a person to hear in a real window.
// Opens its own file, so it also runs alone.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const path = require("path");

module.exports = async function (h) {
  const { js, key, click, drag, slide, openFile, toasts, clearToasts, playing, ensurePaused, check, sleep, FIXTURES } =
    h;

  const view = () =>
    js(`(() => {
      const part = document.getElementById("recordingSection");
      const button = part.querySelector(".recording-action");
      const note = part.querySelector(".recording-note");
      return {
        shown: !part.hidden,
        button: button.textContent,
        disabled: button.disabled,
        on: button.classList.contains("on"),
        row: !part.querySelector(".recording-mixer").hidden,
        name: part.querySelector(".recording-name").textContent,
        silent: part.querySelector(".recording-row").classList.contains("silent"),
        note: note.hidden ? "" : note.textContent,
        takes: [...part.querySelectorAll(".recording-menu [role=menuitemradio]")].map((item) => ({
          label: item.querySelector(".menu-label").textContent,
          detail: item.querySelector("small").textContent,
          checked: item.ariaChecked === "true",
        })),
      };
    })()`);
  const record = () => js(`document.querySelector("#recordingSection .recording-action").click()`);
  // Until the recording is kept (or dropped): the button is Record again.
  const idle = async () => {
    for (let i = 0; i < 60; i++) {
      const v = await view();
      if (!v.disabled && !v.on) return;
      await sleep(50);
    }
  };
  const recording = async () => {
    for (let i = 0; i < 60; i++) {
      if ((await view()).on) return;
      await sleep(50);
    }
  };
  const problems = () => js(`(window.__problems ?? []).length`);
  const problemsBefore = await problems();

  await openFile(path.join(FIXTURES, "tone.wav"));
  let v = await view();
  check("recording: its part of the Mixer shows, with Record", v.shown && v.button === "● Record" && !v.disabled);
  check("recording: no take's row before a take", !v.row && v.takes.length === 0);

  /* ---------- One take ---------- */

  await click(3);
  await clearToasts();
  await record();
  await recording();
  v = await view();
  check(
    "Record starts playback and says it's recording",
    (await playing()) && v.on && /Stop recording/.test(v.button),
    v.button,
  );
  await sleep(2000);
  await record();
  await idle();
  v = await view();
  check("stopping the recording leaves the track playing", await playing());
  await ensurePaused();
  check(
    "a recording without a loop is one take, which shows in the Mixer",
    v.row && v.name === "Take 1" && v.takes.length === 1,
    JSON.stringify(v.takes),
  );
  check(
    "the take says where it starts and its speed",
    /^0:0(2\.9|3\.0)\d+ · 1\.00×$/.test(v.takes[0]?.detail ?? ""),
    v.takes[0]?.detail,
  );
  check(
    "the take is announced",
    (await toasts()).some((t) => t.text === "Take 1 recorded"),
    JSON.stringify(await toasts()),
  );

  /* ---------- Around the loop ---------- */

  await drag(1, 2, ["shift"]); // a loop from 1 s to 2 s
  await click(1.5);
  await clearToasts();
  await record();
  await recording();
  await sleep(3200); // half a time around, then two whole ones, and some
  key(","); // pausing ends the recording
  await idle();
  v = await view();
  check("pausing ends the recording", !v.on && !(await playing()), v.button);
  const looped = v.takes.filter((take) => take.label !== "Take 1");
  check("each time around the loop is a take", looped.length >= 3, JSON.stringify(v.takes));
  check(
    "a take of a whole time around starts at the loop's start",
    looped.filter((take) => /^0:01\.000 · /.test(take.detail)).length >= 2,
    JSON.stringify(looped),
  );
  // Paused part way around: the last whole time around plays, not the part after it.
  check("the newest whole take is the one that plays", v.takes[1]?.checked && v.name === v.takes[1]?.label, v.name);

  /* ---------- Playing it, the speed, the list ---------- */

  key(",");
  await sleep(1500); // the take plays around the loop
  await ensurePaused();
  check(
    "a take plays with the track without errors",
    (await problems()) === problemsBefore,
    await js(`JSON.stringify(window.__problems ?? [])`),
  );

  await slide("speed", 0.7);
  await sleep(400);
  v = await view();
  check("at another speed the take is silent, and says why", v.silent && /Recorded at 1\.00×/.test(v.note), v.note);
  await slide("speed", 1);
  await sleep(400);
  v = await view();
  check("back at its speed it plays again", !v.silent && v.note === "");

  await js(`document.querySelector("#recordingSection .recording-name").click()`);
  await sleep(100);
  await js(`[...document.querySelectorAll(".recording-menu [role=menuitemradio]")].at(-1).click()`);
  await sleep(100);
  v = await view();
  check("an earlier take is chosen from the list", v.name === "Take 1" && v.takes.at(-1).checked, v.name);
  const before = v.takes.length;
  await js(`document.querySelector('.recording-menu [data-action="delete"]').click()`);
  await sleep(100);
  v = await view();
  check(
    "a take is deleted from the list; the newest plays instead",
    v.takes.length === before - 1 && v.name !== "Take 1",
    v.name,
  );

  /* ---------- What ends a recording; another file ---------- */

  key("L"); // the loop off
  await sleep(100);
  const count = v.takes.length;
  await click(4);
  await record();
  await recording();
  await sleep(1200);
  await click(6); // a seek
  await idle();
  v = await view();
  check(
    "a seek ends the recording, keeping the take so far",
    !v.on && v.takes.length === count + 1,
    JSON.stringify(v.takes[0]),
  );
  await ensurePaused();

  await openFile(path.join(FIXTURES, "clicks.wav"));
  v = await view();
  check("another file starts without takes", !v.row && v.takes.length === 0 && v.button === "● Record");
  check(
    "recording: no page errors",
    (await problems()) === problemsBefore,
    await js(`JSON.stringify(window.__problems ?? [])`),
  );
};
