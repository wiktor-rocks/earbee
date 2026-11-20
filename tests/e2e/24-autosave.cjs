// Save projects automatically (Settings › General; "Saving by itself" in
// src/features/project/index.js): off at first; on, a project saves itself
// a moment after a change, quietly, but not while playing, while a name is
// being typed or while the stems are being separated; a song never saved
// isn't; opening another file saves first, without asking; a project with
// its media inside saves too; a failure is shown once. (Closing without
// asking is guardClose's: tests/unit/close-guard.test.mjs.) Opens what it
// needs, so it also runs alone.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const fs = require("fs");
const path = require("path");

module.exports = async function (h) {
  const { js, key, check, sleep, setFiles, click, toasts, clearToasts, ensurePaused } = h;
  const { projectDialogs, setStemDelay, setSaveDelay, memory, FIXTURES, OUTPUT } = h;

  const folder = path.join(OUTPUT, "autosave");
  // Writable again first, in case a run before stopped while it wasn't.
  if (fs.existsSync(folder)) fs.chmodSync(folder, 0o755);
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  const song = (name, fixture = "tone.wav") => {
    const file = path.join(folder, name);
    fs.copyFileSync(path.join(FIXTURES, fixture), file);
    return file;
  };
  const idle = async () => {
    await sleep(200);
    for (let i = 0; i < 300; i++) {
      if (await js(`loadingOverlay.hidden && loadingScreen.hidden && !document.getElementById("app").inert`)) break;
      await sleep(50);
    }
    await sleep(300);
  };
  const open = async (file) => {
    await setFiles(file);
    await idle();
  };
  const setAutosave = (on) =>
    js(`import("./src/ui/prefs.js").then(({ setPref }) => setPref("general", "autosave", ${on}))`);
  const title = () => js(`document.title`);
  const unsaved = async () => (await title()).endsWith(" •");
  const marksIn = (file) => JSON.parse(fs.readFileSync(file, "utf8")).sections.marks.marks?.length ?? 0;
  // A wait longer than CONFIG.project.autosaveDelay, and the save.
  const waitOut = () => sleep(3000);
  // `work` with the folder read-only (nothing can be saved there); writable
  // again afterwards, whatever happens.
  const readOnly = async (work) => {
    fs.chmodSync(folder, 0o555);
    try {
      return await work();
    } finally {
      fs.chmodSync(folder, 0o755);
    }
  };
  const addMark = async (time) => {
    await click(time);
    key("M");
    await sleep(200);
  };
  const saveAs = async (file, embed = false) => {
    projectDialogs.save = file;
    await js(`saveAsButton.click()`);
    await sleep(150);
    await js(`${embed ? "saveModeEmbed" : "saveModeLink"}.click(); saveForm.requestSubmit()`);
    await sleep(800);
  };
  projectDialogs.confirm = "cancel"; // if anything asks, nothing is lost and the check sees it

  /* ---------- Off at first ---------- */

  await setAutosave(false);
  check(
    "autosave: off at first, in Settings › General",
    (await js(
      `import("./src/prefs/index.js").then(({ getSection }) => getSection("general").fields.find((f) => f.key === "autosave")?.default)`,
    )) === false,
  );
  const work = path.join(folder, "work.ebee");
  projectDialogs.confirm = "discard"; // what an earlier topic left open
  await open(song("work.wav"));
  projectDialogs.confirm = "cancel";
  await ensurePaused();
  await saveAs(work);
  await addMark(2);
  await waitOut();
  check("autosave off: a change isn't saved", marksIn(work) === 0 && (await unsaved()));

  /* ---------- On ---------- */

  await clearToasts();
  await setAutosave(true);
  await waitOut();
  check("turning it on saves what wasn't", marksIn(work) === 1 && !(await unsaved()), await title());
  await addMark(3);
  await waitOut();
  check("autosave: a change saves itself", marksIn(work) === 2 && !(await unsaved()), await title());
  check("…quietly: no Project saved", !(await toasts()).some((t) => t.text === "Project saved"));

  /* ---------- Not while playing ---------- */

  await click(4);
  key("Space");
  await sleep(500);
  key("M"); // at the playhead, while it plays
  await sleep(200);
  const playing = await js(`import("./src/context.js").then(({ player }) => player.transport.playing)`);
  await waitOut();
  const whilePlaying = marksIn(work);
  await ensurePaused();
  await waitOut();
  check(
    "autosave: not while playing; saved once it stops",
    playing && whilePlaying === 2 && marksIn(work) === 3,
    JSON.stringify({ playing, whilePlaying, after: marksIn(work) }),
  );

  /* ---------- Not while a name is typed ---------- */

  await js(
    `(() => { const name = document.querySelector("#marksList .mark-name"); name.focus(); name.value = "Ver"; name.dispatchEvent(new Event("input")); })()`,
  );
  await waitOut();
  const typed = JSON.parse(fs.readFileSync(work, "utf8")).sections.marks.marks.map((m) => m.label ?? m.name);
  check("autosave: not in the middle of a name", !typed.includes("Ver"), JSON.stringify(typed));
  await js(
    `(() => { const name = document.querySelector("#marksList .mark-name"); name.value = "Verse"; name.dispatchEvent(new Event("change")); name.blur(); })()`,
  );
  await waitOut();
  const named = JSON.stringify(JSON.parse(fs.readFileSync(work, "utf8")).sections.marks);
  check("…saved once it's in", named.includes("Verse"), named.slice(0, 200));

  /* ---------- A failure, shown once ---------- */

  const { first, second } = await readOnly(async () => {
    await addMark(5);
    await waitOut();
    const first = await js(`__message()?.text ?? ""`);
    await js(`import("./src/ui/dom.js").then(({ clearMessage }) => clearMessage())`);
    await addMark(6);
    await waitOut();
    return { first, second: await js(`__message()?.text ?? ""`) };
  });
  check(
    "autosave: a save that fails says so once, not again for the next change",
    /Couldn't save the project/.test(first) && second === "" && (await unsaved()),
    JSON.stringify({ first, second }),
  );
  await addMark(7);
  await waitOut();
  check("…and saves again once it can", !(await unsaved()) && marksIn(work) === 6, String(marksIn(work)));

  /* ---------- A song never saved; opening another file ---------- */

  const asked = projectDialogs.asked.length;
  await open(song("loose.wav"));
  await addMark(2);
  await waitOut();
  check(
    "autosave: a song never saved stays unsaved, and nothing asks",
    (await unsaved()) && projectDialogs.asked.length === asked,
  );
  projectDialogs.confirm = "discard";
  const other = path.join(folder, "other.ebee");
  await saveAs(other);
  await addMark(3);
  await sleep(300); // less than the wait: not saved yet
  const before = projectDialogs.asked.length;
  await open(song("next.wav"));
  check(
    "autosave: opening another file saves first, without asking",
    marksIn(other) === 2 && projectDialogs.asked.length === before,
    JSON.stringify({ marks: marksIn(other), asked: projectDialogs.asked.slice(before) }),
  );

  /* ---------- The media inside ---------- */

  const inside = path.join(folder, "inside.ebee");
  await saveAs(inside, true);
  check("autosave: a project with its media inside", fs.existsSync(inside) && !(await unsaved()));
  const header = () => {
    const bytes = fs.readFileSync(inside);
    return JSON.parse(bytes.subarray(0, bytes.indexOf(0)).toString("utf8"));
  };
  await addMark(4);
  await waitOut();
  check("…saves itself too", header().sections.marks.marks.length === 1 && !(await unsaved()));
  await open(song("after.wav"));
  await open(inside);
  check("…and still opens, with it", (await js(`document.querySelectorAll("#marksList .mark-row").length`)) === 1);

  /* ---------- While a save is going ---------- */

  // Each save starts 1.5 s late, as a big project's takes a while.
  const marksInside = () => header().sections.marks.marks.length;
  const length = () => js(`import("./src/context.js").then(({ player }) => player.transport.duration)`);
  const fullLength = await length();
  setSaveDelay(1500);
  await addMark(5);
  await sleep(2400); // the save by itself has started, and is still going
  await addMark(6);
  await sleep(1500); // it's done; the second mark came too late for it
  const afterFirst = { marks: marksInside(), unsaved: await unsaved() };
  await sleep(4500); // the next save by itself
  check(
    "autosave: a change made while a save is going stays unsaved, then saves itself",
    afterFirst.marks === 2 && afterFirst.unsaved && marksInside() === 3 && !(await unsaved()),
    JSON.stringify({ afterFirst, then: marksInside() }),
  );

  await addMark(7);
  await sleep(2400); // saving by itself
  key("S", ["control"]); // and Ctrl+S meanwhile: it waits for that save
  await sleep(4500);
  setSaveDelay(0);
  const savedTwice = { marks: marksInside(), unsaved: await unsaved() };
  await open(song("between.wav"));
  await open(inside);
  check(
    "…Ctrl+S during a save waits for it: the project, with its media inside, opens whole",
    savedTwice.marks === 4 &&
      !savedTwice.unsaved &&
      (await js(`document.querySelectorAll("#marksList .mark-row").length`)) === 4 &&
      Math.abs((await length()) - fullLength) < 0.05,
    JSON.stringify({ savedTwice, length: await length(), fullLength }),
  );

  // A name still being typed when another file opens: saved with it.
  await js(
    `(() => { const name = document.querySelector("#marksList .mark-name"); name.focus(); name.value = "Chorus"; name.dispatchEvent(new Event("input")); })()`,
  );
  await open(song("typed.wav"));
  check(
    "autosave: a name being typed is saved when another file opens",
    JSON.stringify(header().sections.marks).includes("Chorus"),
    JSON.stringify(header().sections.marks).slice(0, 200),
  );

  // A project that can't be saved: opening another file asks after all.
  const stuck = path.join(folder, "stuck.ebee");
  await saveAs(stuck);
  const leaveFor = song("leave-for.wav");
  await addMark(2);
  await clearToasts();
  projectDialogs.confirm = "cancel";
  const askedBefore = projectDialogs.asked.length;
  const stuckTitle = await readOnly(async () => {
    await open(leaveFor);
    const stuckTitle = await title();
    projectDialogs.confirm = "discard";
    await open(leaveFor);
    return stuckTitle;
  });
  check(
    "autosave: a project that can't be saved asks Save / Don't save / Cancel before another file opens",
    projectDialogs.asked.slice(askedBefore).filter(([kind]) => kind === "confirm").length === 2 &&
      stuckTitle.includes("stuck.ebee") &&
      (await title()).includes("leave-for.wav"),
    JSON.stringify({ asked: projectDialogs.asked.slice(askedBefore), stuckTitle, now: await title() }),
  );
  projectDialogs.confirm = "cancel";

  /* ---------- A save still writing when something else opens ---------- */

  // Autosave off: Ctrl+S on a project, then, while it's writing, another
  // change and another file, with Don't save. The save ends after the
  // song has opened, and leaves the song as it is: not that project.
  await setAutosave(false);
  const late = path.join(folder, "late.ebee");
  await saveAs(late);
  const lateSong = song("late-song.wav");
  await addMark(2);
  setSaveDelay(4000); // long enough for the song to open meanwhile
  key("S", ["control"]);
  await sleep(300);
  await addMark(3);
  projectDialogs.confirm = "discard";
  await open(lateSong);
  const openedFirst = (await title()).includes("late-song.wav") && fs.statSync(late).mtimeMs < Date.now() - 1000;
  await sleep(4500); // the save has ended
  setSaveDelay(0);
  const lateTitle = await title();
  projectDialogs.save = null; // Save As canceled, if it's asked
  const askedAt = projectDialogs.asked.length;
  key("S", ["control"]);
  await sleep(500);
  await js(`saveDialog.open && saveDialog.close("")`);
  check(
    "a save that ends after another file has opened leaves that file alone: Ctrl+S asks where to save the song",
    openedFirst &&
      lateTitle.includes("late-song.wav") &&
      !lateTitle.includes("late.ebee") &&
      (await js(`document.title`)).includes("late-song.wav") &&
      marksIn(late) === 1 &&
      projectDialogs.asked.length === askedAt,
    JSON.stringify({ openedFirst, lateTitle, marks: marksIn(late), asked: projectDialogs.asked.slice(askedAt) }),
  );
  projectDialogs.confirm = "cancel";
  await setAutosave(true);

  /* ---------- Stems ---------- */

  memory.available = 16e9; // as topic 21: pretend there's plenty
  const stemsProject = path.join(folder, "stems.ebee");
  await open(song("stems.wav"));
  await ensurePaused();
  await saveAs(stemsProject);
  setStemDelay(400);
  await js(`document.querySelector("#stemsSection .stems-whole").click()`);
  const stage = () => js(`import("./src/features/stems/index.js").then(({ stemsStage }) => stemsStage())`);
  for (let i = 0; i < 200 && !["separate", "rest"].includes(await stage()); i++) await sleep(50);
  await addMark(1);
  await waitOut();
  const separating = await stage();
  const duringSeparation = marksIn(stemsProject);
  for (let i = 0; i < 1200 && (await stage()) !== "ready"; i++) await sleep(100);
  setStemDelay(0);
  for (let i = 0; i < 100 && (await unsaved()); i++) await sleep(200);
  const saved = JSON.parse(
    (() => {
      const bytes = fs.readFileSync(stemsProject);
      const end = bytes.indexOf(0);
      return bytes.subarray(0, end === -1 ? bytes.length : end).toString("utf8");
    })(),
  );
  check(
    "autosave: not while the stems are being separated; saved, with them, once they're ready",
    (!["separate", "rest"].includes(separating) || duringSeparation === 0) &&
      saved.sections.marks.marks.length === 1 &&
      Boolean(saved.sections.stems?.stems) &&
      !(await unsaved()),
    JSON.stringify({ separating, duringSeparation, stems: Boolean(saved.sections.stems?.stems) }),
  );
  memory.available = null;

  /* ---------- Off again ---------- */

  await setAutosave(false);
  await addMark(2);
  await waitOut();
  check("autosave off again: a change waits for Save", await unsaved());
  projectDialogs.confirm = "discard";
};
