// The last session (src/features/project/last-session.js,
// electron/session-store.js): kept as you go, offered back on the welcome
// screen after a reload ("Pick up where you left off"), for a song never
// saved and for a project with unsaved changes (its file untouched), a
// project saved since, a song that has gone, forgetting it, a new file
// replacing it, and stems coming back without separating again. Starts
// from an empty folder on a fresh page, so it also runs alone. (A real
// restart and a kill: tests/smoke.cjs.)
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const fs = require("fs");
const path = require("path");

module.exports = async function (h) {
  const { wc, js, key, check, sleep, setFiles, slide, click, shot, toasts, ensurePaused } = h;
  const { projectDialogs, sessions, lastSessionFolder, memory, setStemCopyDelay, FIXTURES, OUTPUT } = h;

  const folder = path.join(OUTPUT, "last-session-media");
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  const song = (name, fixture = "tone.wav") => {
    const file = path.join(folder, name);
    fs.copyFileSync(path.join(FIXTURES, fixture), file);
    return file;
  };
  const sessionFile = path.join(lastSessionFolder, "session.json");
  const kept = () => (fs.existsSync(sessionFile) ? JSON.parse(fs.readFileSync(sessionFile, "utf8")) : null);

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
  // A fresh page: the welcome screen again, as after a restart.
  const welcomeAgain = async () => {
    await wc.reload();
    await sleep(1500);
  };
  // Waits out the autosave (CONFIG.session.autosaveDelay) and its write.
  const autosaved = () => sleep(2600);
  const title = () => js(`document.title`);
  const unsaved = async () => (await title()).endsWith(" •");
  const offer = () =>
    js(`welcomeSession.checkVisibility() ? {
      name: welcomeSession.querySelector(".recent-name").textContent,
      detail: welcomeSession.querySelector(".recent-folder").textContent,
    } : null`);
  const reopen = async () => {
    await js(`welcomeSession.querySelector(".recent-open").click()`);
    await idle();
  };
  // What a session brings back, as shown.
  const state = () =>
    js(`(() => ({
      speed: speedValue.textContent,
      semitones: semitoneValue.textContent,
      loop: loopInfo.hidden ? null : loopInfo.textContent,
      marks: [...document.querySelectorAll("#marksList .mark-row")].map((row) =>
        row.querySelector(".mark-name").value + " @ " + row.querySelector(".mark-time").textContent),
      time: trackTime.textContent.split(" / ")[0],
    }))()`);
  const markCount = () => js(`document.querySelectorAll("#marksList .mark-row").length`);
  projectDialogs.confirm = "discard";
  projectDialogs.locate = null;

  /* ---------- Nothing yet ---------- */

  // (Reloaded first: a page that still has a file open keeps it as it goes.)
  await welcomeAgain();
  sessions.forget();
  await welcomeAgain();
  check("last session: nothing kept yet, nothing offered", (await offer()) === null);

  /* ---------- A song, never saved ---------- */

  const first = song("first.wav");
  await open(first);
  await ensurePaused();
  await slide("speed", 0.7);
  await slide("semitoneShift", 2);
  await click(2);
  key("[");
  await click(6);
  key("]");
  await click(3);
  key("M");
  await sleep(150);
  await js(`document.querySelector("#marksList .mark-name").value = "Verse"`);
  await js(`document.querySelector("#marksList .mark-name").dispatchEvent(new Event("change"))`);
  await click(4.5);
  await autosaved();
  const before = await state();
  check(
    "last session: the session is set up",
    before.marks.length === 1 && before.loop && before.speed !== "1.00×",
    JSON.stringify(before),
  );
  const written = kept();
  check(
    "last session: kept as you go, with the song's place and every section",
    written?.media?.path === first &&
      written.project === null &&
      written.unsaved === true &&
      ["sound", "marks", "loop", "playback", "view"].every((id) => written.sections?.[id]?.version >= 1),
    JSON.stringify(written && { media: written.media, project: written.project, unsaved: written.unsaved }),
  );

  await welcomeAgain();
  const offered = await offer();
  check(
    "last session: after a restart, the welcome screen offers it",
    offered?.name === "first.wav" && /^today \d\d:\d\d · unsaved changes$/.test(offered.detail),
    JSON.stringify(offered),
  );
  await shot("last-session-offer.png");
  await reopen();
  const after = await state();
  check(
    "last session: Reopen brings it back as it was (sound, loop, marks, place)",
    JSON.stringify(after) === JSON.stringify(before),
    JSON.stringify({ before, after }),
  );
  check("…with the • (it was never saved)", await unsaved(), await title());
  check(
    "…and says so",
    (await toasts()).some((t) => t.text === "Reopened “first.wav”"),
  );

  /* ---------- A saved project, then a change not saved ---------- */

  const projectFile = path.join(folder, "work.ebee");
  projectDialogs.save = projectFile;
  await js(`saveAsButton.click()`);
  await sleep(150);
  await js(`saveModeLink.click(); saveForm.requestSubmit()`);
  await sleep(600);
  check("last session: the project is saved", fs.existsSync(projectFile) && !(await unsaved()));
  const projectBytes = fs.readFileSync(projectFile);
  await click(7);
  key("M");
  await autosaved();
  check("last session: a mark added after saving is an unsaved change", await unsaved());
  check("…the project's file isn't touched", Buffer.compare(fs.readFileSync(projectFile), projectBytes) === 0);
  check(
    "…the last session names the project",
    kept()?.project?.path === projectFile && kept()?.unsaved === true,
    JSON.stringify(kept()?.project),
  );
  const withChange = await state();

  await welcomeAgain();
  const offeredProject = await offer();
  check(
    "last session: a project's session is offered by the project's name",
    offeredProject?.name === "work.ebee" && /unsaved changes/.test(offeredProject.detail),
    JSON.stringify(offeredProject),
  );
  await reopen();
  check(
    "last session: Reopen opens the project with the change over it",
    JSON.stringify(await state()) === JSON.stringify(withChange) && (await markCount()) === 2,
    JSON.stringify(await state()),
  );
  check("…with the • (not saved yet)", await unsaved(), await title());
  key("S", ["control"]);
  await sleep(600);
  check(
    "…and Save writes it into the project",
    !(await unsaved()) && JSON.parse(fs.readFileSync(projectFile, "utf8")).sections.marks.marks?.length === 2,
    await title(),
  );
  await autosaved();
  check("…after which the session has nothing unsaved", kept()?.unsaved === false);

  // Ctrl+S with nothing to save still writes the file again (a newer
  // time on it): the session follows, so Reopen still comes back here.
  await click(5);
  await autosaved();
  const place = (await state()).time;
  key("S", ["control"]);
  await sleep(600);
  await autosaved();
  await welcomeAgain();
  await reopen();
  const afterResave = { message: await js(`__message()?.text ?? ""`), time: (await state()).time };
  check(
    "last session: Ctrl+S with nothing unsaved, then Reopen: back where you were, not “saved since”",
    !/was saved since/.test(afterResave.message) && afterResave.time === place,
    JSON.stringify({ place, ...afterResave }),
  );

  /* ---------- The project saved since ---------- */

  await click(9);
  key("M");
  await autosaved();
  check("last session: another change, not saved", await unsaved());
  await welcomeAgain();
  // Saved elsewhere meanwhile (another EarBee): a newer time on the file.
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(projectFile, later, later);
  await reopen();
  check(
    "last session: a project saved since opens as saved, with a notice",
    (await markCount()) === 2 && !(await unsaved()) && /was saved since/.test(await js(`__message()?.text ?? ""`)),
    JSON.stringify({ marks: await markCount(), title: await title(), message: await js(`__message()?.text ?? ""`) }),
  );

  /* ---------- A song that has gone; forgetting ---------- */

  const gone = song("gone.wav");
  await open(gone);
  await click(1);
  key("M");
  await autosaved();
  await welcomeAgain();
  fs.rmSync(gone);
  await reopen();
  check(
    "last session: a song that has gone says so",
    /gone\.wav.*any more/.test(await js(`__message()?.text ?? ""`)) && !(await js(`welcome.hidden`)),
    await js(`__message()?.text ?? ""`),
  );
  check("…and the offer stays", (await offer())?.name === "gone.wav");
  await js(`welcomeSession.querySelector(".recent-remove").click()`);
  await sleep(300);
  check("last session: × forgets it", (await offer()) === null && kept() === null);
  await welcomeAgain();
  check("…for good", (await offer()) === null);

  /* ---------- A new file replaces it ---------- */

  const second = song("second.wav");
  const third = song("third.wav");
  await open(second);
  await autosaved();
  await open(third);
  await autosaved();
  check("last session: opening another file replaces it", kept()?.media?.path === third, kept()?.media?.path);
  await welcomeAgain();
  check("…and that's what's offered, with nothing unsaved", (await offer())?.detail?.includes("unsaved") === false);

  /* ---------- Stems ---------- */

  memory.available = 16e9; // as topic 21: pretend there's plenty
  const stemsSong = song("stems.wav");
  await open(stemsSong);
  await ensurePaused();
  await js(`document.querySelector("#stemsSection .stems-whole").click()`);
  const stemsReady = () =>
    js(
      `(() => { const s = document.getElementById("stemsSection"); return !s.querySelector(".stems-mixer").hidden && s.querySelector(".stems-busy").hidden && s.querySelector(".stems-preparing").hidden; })()`,
    );
  for (let i = 0; i < 1200 && !(await stemsReady()); i++) await sleep(100);
  check("last session: stems separated", await stemsReady());
  const stemsFiles = () => fs.readdirSync(lastSessionFolder).filter((name) => /^stems-.*\.bin$/.test(name));
  for (let i = 0; i < 300 && !(kept()?.stems && stemsFiles().length); i++) await sleep(100);
  await autosaved();
  check(
    "last session: the stems are copied once, beside it",
    stemsFiles().length === 1 &&
      kept()?.stems?.file === stemsFiles()[0] &&
      kept()?.sections?.stems?.stems?.audio === "file",
    JSON.stringify({ files: stemsFiles(), stems: kept()?.stems?.file, audio: kept()?.sections?.stems?.stems?.audio }),
  );
  // Muted: a light change, the stems aren't copied again.
  await js(`document.querySelector("#stemsSection .stems-row button[title^=Mute]").click()`);
  await autosaved();
  check("…a change to the mix doesn't copy them again", stemsFiles().length === 1, stemsFiles().join());
  await welcomeAgain();
  await reopen();
  for (let i = 0; i < 300 && !(await stemsReady()); i++) await sleep(100);
  check(
    "last session: the stems come back without separating again, with the mix",
    (await stemsReady()) &&
      (await js(`document.querySelector("#stemsSection .stems-row button[title^=Mute]").ariaPressed`)) === "true",
  );
  await autosaved();
  check(
    "…and still aren't copied again",
    stemsFiles().length === 1 && kept()?.sections?.stems?.stems?.audio === "file",
  );

  /* ---------- Playback comes first ---------- */

  // What a write costs the page while playing, with stems: capturing every
  // section, the JSON, the message (each write with a new mark, so it's
  // never skipped as unchanged); and no long task meanwhile.
  await js(
    `(window.__longTasks = [], new PerformanceObserver((list) => window.__longTasks.push(...list.getEntries().map((e) => e.duration))).observe({ type: "longtask" }))`,
  );
  key("Space");
  await sleep(500);
  const costs = await js(`(async () => {
    const { keepNow } = await import("./src/features/project/last-session.js");
    const costs = [];
    for (let i = 0; i < 10; i++) {
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyM", key: "m", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      // The page's own part (until the message goes), then the answer.
      const start = performance.now();
      const answered = keepNow();
      const page = performance.now() - start;
      await answered;
      costs.push({ page, total: performance.now() - start });
    }
    return costs;
  })()`);
  await sleep(300);
  const longTasks = await js(`window.__longTasks`);
  await ensurePaused();
  const round = (ms) => Math.round(ms * 10) / 10;
  check(
    "last session: a write while playing takes the page a few milliseconds, with no long task",
    Math.max(...costs.map((cost) => cost.page)) < 20 && longTasks.length === 0,
    JSON.stringify({
      page: costs.map((cost) => round(cost.page)),
      total: costs.map((cost) => round(cost.total)),
      longTasks,
    }),
  );

  /* ---------- Stems the project has: no copy of its own ---------- */

  // New stems, being copied slowly; playback starts, which holds the copy;
  // meanwhile the song is saved as a project, with the stems inside. Once
  // paused, the copy isn't needed: it stops, and the session names the
  // project's own stems. (The earlier song's copy stays this window's until
  // it closes, as before.)
  const filesBefore = fs.readdirSync(lastSessionFolder).filter((name) => name.startsWith("stems-"));
  const copySong = song("copy.wav");
  await open(copySong);
  await ensurePaused();
  setStemCopyDelay(1500);
  await js(`document.querySelector("#stemsSection .stems-whole").click()`);
  for (let i = 0; i < 1200 && !(await stemsReady()); i++) await sleep(100);
  const copyFiles = () => fs.readdirSync(lastSessionFolder).filter((name) => name.startsWith("stems-"));
  for (let i = 0; i < 100 && !copyFiles().some((name) => name.endsWith(".tmp")); i++) await sleep(100);
  const copying = copyFiles().some((name) => name.endsWith(".tmp"));
  key("Space");
  await sleep(300);
  const copyProject = path.join(folder, "copy.ebee");
  projectDialogs.save = copyProject;
  await js(`saveAsButton.click()`);
  await sleep(150);
  await js(`saveModeLink.click(); saveForm.requestSubmit()`);
  for (let i = 0; i < 100 && (await unsaved()); i++) await sleep(100);
  await sleep(2000); // the copy holds while playing
  await ensurePaused();
  await sleep(4000); // the stem being added, then the copy sees it isn't needed
  setStemCopyDelay(0);
  await autosaved();
  check(
    "last session: a copy of stems the project has meanwhile stops, leaving nothing; the session names the project's",
    copying &&
      fs.existsSync(copyProject) &&
      kept()?.project?.path === copyProject &&
      kept()?.sections?.stems?.stems?.audio === "project" &&
      JSON.stringify(copyFiles()) === JSON.stringify(filesBefore), // nothing new: no copy, no .tmp
    JSON.stringify({
      filesBefore,
      copying,
      files: copyFiles(),
      audio: kept()?.sections?.stems?.stems?.audio,
      project: kept()?.project?.path,
    }),
  );
  memory.available = null;
};
