// Project files (.ebee): saving a session (marks, sound settings, loop,
// step, place, zoom) linked to its media or with it inside, opening it
// back, unsaved changes (the • in the title, the question before they're
// lost), and a project whose media moved with it.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const fs = require("fs");
const path = require("path");

module.exports = async function (h) {
  const {
    wc,
    js,
    dbg,
    key,
    click,
    slide,
    ensurePaused,
    check,
    sleep,
    projectDialogs,
    projectState,
    prefsStore,
    toasts,
    clearToasts,
    shot,
    FIXTURES,
    OUTPUT,
  } = h;
  const folder = path.join(OUTPUT, "projects");
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });

  // Opens a file through the file input, as the Open button does, and
  // waits for it (no zooming out afterwards, unlike h.openFile).
  async function open(file) {
    const { root } = await dbg.sendCommand("DOM.getDocument");
    const { nodeId } = await dbg.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector: "#file" });
    await dbg.sendCommand("DOM.setFileInputFiles", { nodeId, files: [file] });
    await sleep(300);
    for (let i = 0; i < 200; i++) {
      if (await js(`loadingOverlay.hidden && loadingScreen.hidden && !play.disabled`)) break;
      await sleep(50);
    }
    await sleep(300);
  }
  // Everything a project brings back, as shown.
  const session = () =>
    js(`(() => {
      const view = document.querySelector("#waveform > div").shadowRoot.querySelector(".scroll");
      return {
        speed: speedValue.textContent, volume: volumeValue.textContent, semitones: semitoneValue.textContent,
        cents: centValue.textContent, eqLow: eqLowValue.textContent, eqHigh: eqHighValue.textContent,
        eq: eqToggle.textContent, step: stepSize.textContent, loop: loopInfo.hidden ? null : loopInfo.textContent,
        loopOff: loopInfo.classList.contains("disabled"),
        marks: [...document.querySelectorAll("#marksList .mark-row")].map((row) =>
          row.querySelector(".mark-name").value + " @ " + row.querySelector(".mark-time").textContent),
        time: trackTime.textContent.split(" / ")[0], start: startPoint.textContent,
        zoom: Math.round(view.scrollWidth), scroll: Math.round(view.scrollLeft),
        split: document.getElementById("stage").style.getPropertyValue("--timeline-share"),
      };
    })()`);
  const title = () => js(`document.title`);
  const unsaved = async () => (await title()).endsWith(" •");
  const saveDialogOpen = () => js(`saveDialog.open`);
  const wheel = async (deltaY) => {
    const { x, y } = await js(
      `(() => { const r = document.getElementById("waveform").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 3), y: Math.round(r.top + r.height / 2) }; })()`,
    );
    wc.sendInputEvent({ type: "mouseWheel", x, y, deltaX: 0, deltaY });
    await sleep(200);
  };

  const tone = path.join(FIXTURES, "tone.wav");
  projectDialogs.confirm = "discard";
  await open(tone);
  await ensurePaused();
  check("the Save button is shown in the app", await js(`!saveButton.hidden`));
  check("a file just opened has nothing unsaved", !(await unsaved()), await title());

  // Open, Save, Save as and From YouTube are in the File menu.
  const fileMenuOpen = () => js(`fileMenu.matches(":popover-open")`);
  await js(`fileMenuButton.click()`);
  await sleep(150);
  const items = await js(
    `[...fileMenu.querySelectorAll(".menu-item")].filter((item) => item.checkVisibility()).map((item) => item.querySelector(".menu-label").textContent)`,
  );
  check(
    "File opens a menu: Open…, Save, Save as…, From YouTube…, the first focused",
    (await fileMenuOpen()) &&
      JSON.stringify(items) === JSON.stringify(["Open…", "Save", "Save as…", "From YouTube…"]) &&
      (await js(`document.activeElement.id`)) === "openButton" &&
      (await js(`fileMenuButton.getAttribute("aria-expanded")`)) === "true",
    JSON.stringify(items),
  );
  await shot("file-menu.png");
  key("Down");
  await sleep(50);
  check("↓ moves to Save", (await js(`document.activeElement.id`)) === "saveButton");
  key("Escape");
  await sleep(150);
  // Not opened from the keyboard (Tab): no focus is left on File, as with
  // the theme menu (see bindFocus in ui/shortcuts.js).
  check(
    "Escape closes it, File no longer expanded",
    !(await fileMenuOpen()) &&
      (await js(`document.activeElement === document.body`)) &&
      (await js(`fileMenuButton.getAttribute("aria-expanded")`)) === "false",
  );
  await js(`fileMenuButton.click()`);
  await sleep(150);
  await js(`downloadButton.click()`);
  await sleep(150);
  check(
    "picking From YouTube… closes the menu and opens its dialog",
    !(await fileMenuOpen()) && (await js(`downloadDialog.open`)),
  );
  await js(`downloadDialog.close()`);
  await sleep(100);

  // A session: sound, marks, loop, step, place and zoom.
  await slide("speed", 0.7);
  await sleep(100);
  check("changing the speed is an unsaved change (• in the title)", await unsaved(), await title());
  await slide("volume", 140);
  await slide("semitoneShift", 2);
  await slide("centShift", -15);
  await slide("eqLow", 4.5);
  await slide("eqHigh", -6);
  await js(`eqToggle.click()`);
  key("Up");
  await click(2);
  key("[");
  await click(6);
  key("]");
  key("L"); // the loop, off
  await click(3);
  key("M");
  await click(8);
  key("R");
  await click(11);
  key("R");
  await sleep(150);
  await js(`document.querySelector("#marksList .mark-name").value = "Intro"`);
  await js(`document.querySelector("#marksList .mark-name").dispatchEvent(new Event("change"))`);
  await click(12.25);
  for (let i = 0; i < 4; i++) await wheel(600); // zoomed in (Electron's deltaY is the DOM's, inverted), scrolled into the track
  // The video's size (the stage split handle, src/features/stage-split.js),
  // as a drag would leave it; saved even for a song.
  await js(`document.getElementById("stage").style.setProperty("--timeline-share", "0.62")`);
  await sleep(200);
  const before = await session();
  check(
    "the session to save is set up",
    before.marks.length === 2 && before.loop && before.loopOff && before.speed !== "1.00×" && before.scroll > 0,
    JSON.stringify(before),
  );
  check("the main process hears about unsaved changes", projectState.get(wc.id)?.dirty === true);

  // Ctrl+S, the first time: Save As (link to the media), then where.
  const linked = path.join(folder, "Tone session.ebee");
  projectDialogs.save = linked;
  key("S", ["control"]);
  await sleep(200);
  check(
    "Ctrl+S on a new session asks how to save, linking by default",
    (await saveDialogOpen()) && (await js(`saveModeLink.checked && !saveModeLink.disabled`)),
  );
  await js(`saveForm.requestSubmit()`);
  await sleep(500);
  check("…then where, offering the media's name", projectDialogs.asked.at(-1)?.[1]?.endsWith("tone.ebee"));
  check("the project is written", fs.existsSync(linked));
  const saved = JSON.parse(fs.readFileSync(linked, "utf8"));
  check(
    "…as readable JSON linking to the media, with every section",
    saved.media.path === tone &&
      !saved.media.embedded &&
      ["sound", "marks", "loop", "playback", "view", "stage"].every((id) => saved.sections[id]?.version >= 1),
    JSON.stringify(saved.media),
  );
  check(
    "saving shows a notification with where, not a message in the transport bar",
    (await toasts()).some((t) => t.text === "Project saved" && t.detail === linked) &&
      !(await js(`document.getElementById("message").textContent`)).includes("Saved"),
    JSON.stringify(await toasts()),
  );
  await shot("project-saved-toast.png");
  check(
    "after saving, the title names the project and nothing is unsaved",
    (await title()) === "EarBee — Tone session.ebee" && projectState.get(wc.id)?.dirty === false,
    await title(),
  );
  await click(4);
  await wheel(-300);
  check("moving the cursor or zooming isn't an unsaved change", !(await unsaved()));

  // Another file starts afresh; the project brings it all back.
  await open(tone);
  const fresh = await session();
  check("another file starts afresh", fresh.marks.length === 0 && fresh.split === "", JSON.stringify(fresh));
  await open(linked);
  const back = await session();
  check(
    "opening the project brings back marks, sound, loop, step, place, zoom and the video's size",
    JSON.stringify(back) === JSON.stringify(before),
    `${JSON.stringify(before)}\n     ${JSON.stringify(back)}`,
  );
  check("…with nothing unsaved", !(await unsaved()), await title());
  check(
    "opening a project says so in a notification",
    (await toasts()).some((t) => t.text === "Opened “Tone session.ebee”"),
    JSON.stringify(await toasts()),
  );

  // Ctrl+S on an opened project: written in place, no questions. With
  // notifications off (Settings › General), saving shows none.
  prefsStore.set("general", "notifications", false);
  await sleep(200);
  await clearToasts();
  const asked = projectDialogs.asked.length;
  await slide("speed", 0.8);
  key("S", ["control"]);
  await sleep(500);
  check(
    "Ctrl+S on a project saves it in place, without a dialog",
    !(await saveDialogOpen()) &&
      projectDialogs.asked.length === asked &&
      JSON.parse(fs.readFileSync(linked, "utf8")).sections.sound.speed === 0.8 &&
      !(await unsaved()),
  );
  check("with notifications off, saving shows none", (await toasts()).length === 0, JSON.stringify(await toasts()));
  prefsStore.set("general", "notifications", true);
  await sleep(200);

  // Unsaved changes, then another file: Cancel keeps them, Don't save doesn't.
  key("M");
  await sleep(150);
  projectDialogs.confirm = "cancel";
  await open(tone);
  check(
    "Cancel at “Save the changes?” keeps the project open",
    (await title()) === "EarBee — Tone session.ebee •" && projectDialogs.asked.at(-1)?.[0] === "confirm",
    await title(),
  );
  projectDialogs.confirm = "discard";

  // Save As with the media inside (Ctrl+Shift+S): one file that works anywhere.
  const inside = path.join(folder, "Inside.ebee");
  projectDialogs.save = inside;
  key("S", ["control", "shift"]);
  await sleep(200);
  await js(`saveModeEmbed.click(); saveForm.requestSubmit()`);
  await sleep(800);
  const embeddedSession = await session();
  const bytes = fs.readFileSync(inside);
  const nul = bytes.indexOf(0);
  check(
    "with the media inside: the header, then the media's bytes",
    nul > 0 &&
      JSON.parse(bytes.subarray(0, nul).toString()).media.embedded === true &&
      bytes.length - nul - 1 === fs.statSync(tone).size,
  );
  await open(tone);
  await open(inside);
  check(
    "a project with the media inside opens, as saved",
    JSON.stringify(await session()) === JSON.stringify(embeddedSession) &&
      (await js(`fileName.textContent`)) === "tone.wav",
  );
  await js(`saveButton.click()`); // Ctrl+S's button
  await sleep(200);
  check("only the media's way of being saved is offered: inside", !(await saveDialogOpen()));
  key("S", ["control", "shift"]);
  await sleep(200);
  check(
    "…Save As can't link to media that's only inside a project",
    (await js(`saveModeLink.disabled && saveModeEmbed.checked && !saveLinkNote.hidden`)) === true,
  );
  await js(`saveCancel.click()`);

  // Moved, with the media next to it: found by the relative path.
  const moved = path.join(folder, "moved");
  fs.mkdirSync(path.join(moved, "fixtures"), { recursive: true });
  const copy = path.join(moved, "fixtures", "copy.wav");
  fs.copyFileSync(tone, copy);
  const project = JSON.parse(fs.readFileSync(linked, "utf8"));
  project.media = {
    ...project.media,
    path: "/nowhere/copy.wav",
    relativePath: path.join("..", "fixtures", "copy.wav"),
  };
  fs.writeFileSync(path.join(moved, "Moved.ebee"), JSON.stringify(project));
  fs.mkdirSync(path.join(moved, "projects"));
  fs.renameSync(path.join(moved, "Moved.ebee"), path.join(moved, "projects", "Moved.ebee"));
  await open(path.join(moved, "projects", "Moved.ebee"));
  check(
    "a moved project finds its media by where it was relative to it",
    (await js(`fileName.textContent`)) === "copy.wav" && (await session()).marks.length === 2,
  );

  // Gone, and not found: the user is asked, and Cancel leaves things as they were.
  fs.rmSync(copy);
  projectDialogs.locate = null;
  await open(path.join(moved, "projects", "Moved.ebee"));
  check(
    "media that's gone: asked where it is; Cancel changes nothing",
    projectDialogs.asked.at(-1)?.[0] === "locate" && (await js(`fileName.textContent`)) === "copy.wav",
  );

  // The beats, as found and with the project's edits: back at once,
  // without finding them again, and the step "1 beat" with them.
  const chipText = () => js(`beatInfo.textContent`);
  await open(path.join(FIXTURES, "bars.wav"));
  key("B");
  for (let i = 0; i < 400 && /Find|%/.test(await chipText()); i++) await sleep(50);
  await js(`document.querySelector('#beatMenu [data-tempo="0.5"]').click()`);
  await sleep(150);
  check("the beats found and halved: 60 BPM", (await chipText()) === "♩ 60 BPM", await chipText());
  check("finding and editing the beats is an unsaved change", await unsaved(), await title());
  const withBeats = path.join(folder, "Beats.ebee");
  projectDialogs.save = withBeats;
  key("S", ["control", "shift"]);
  await sleep(200);
  await js(`saveModeLink.click(); saveForm.requestSubmit()`);
  await sleep(500);
  const beatsSaved = JSON.parse(fs.readFileSync(withBeats, "utf8")).sections.beats;
  check(
    "the project saves the beats as found (all 40), and the edits apart",
    beatsSaved?.found?.times?.length >= 39 && beatsSaved.found.bars?.length >= 9 && beatsSaved.edits?.tempo === 0.5,
    JSON.stringify(beatsSaved?.edits),
  );
  const beatLinesBefore = await js(`document.querySelectorAll(".guide-beat").length`);
  await open(tone);
  check("another file: no beats", (await chipText()) === "♩ Find the beats", await chipText());
  await open(withBeats);
  check("opening it brings the beats back at once, halved", (await chipText()) === "♩ 60 BPM", await chipText());
  check(
    "…their lines too, and the step 1 beat",
    (await js(`document.querySelectorAll(".guide-beat").length`)) === beatLinesBefore &&
      (await js(`stepSize.textContent`)) === "Step 1 beat",
    await js(`stepSize.textContent`),
  );
  check("…with nothing unsaved", !(await unsaved()), await title());
  await js(`document.querySelector('#beatMenu [data-tempo="0.5"]').click()`);
  await sleep(150);
  check("undoing the half time after reopening: 120 BPM", (await chipText()) === "♩ 120 BPM", await chipText());
  check("…an unsaved change", await unsaved(), await title());

  // The shortcuts dialog lists the File keys.
  check(
    "the legend lists Ctrl+S",
    (await js(`document.getElementById("shortcutList").textContent`)).includes("Ctrl+SSave the project"),
  );
};
