// Marks: points and regions made with the keys, drawn in the marks lane
// above the waveform (with guide lines over it) and on the minimap, listed
// under the controls, dragged, renamed, recoloured, jumped between and
// deleted; a new file starts without them. The waveform itself stays clean.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const path = require("path");

module.exports = async function (h) {
  const { wc, js, openFile, key, xAt, rect, click, shot, pos, ensurePaused, check, sleep, FIXTURES } = h;
  const shadow = `document.querySelector("#waveform > div").shadowRoot`;
  const near = (a, b, within = 0.06) => Math.abs(a - b) <= within;

  // The list, as shown: [{ id, name, start, end, selected }].
  const listed = () =>
    js(`[...document.querySelectorAll("#marksList .mark-row")].map((row) => {
      const [start, end] = row.querySelector(".mark-time").textContent.split(" – ").map(__parseTime);
      return { id: row.dataset.id, name: row.querySelector(".mark-name").value, start, end: end ?? null,
        selected: row.classList.contains("selected") };
    })`);
  const byName = async (name) => (await listed()).find((mark) => mark.name === name);
  // Marks drawn in the lane (`selector` within #marksLane).
  const drawn = (selector) => js(`document.querySelectorAll('#marksLane ${selector}').length`);
  const item = (id) => `document.querySelector('#marksLane [data-mark-id="${id}"]')`;
  // A point on its flag, a region on its bar: where to press to move it.
  const flagBox = (id) =>
    js(
      `(() => { const r = ${item(id)}.querySelector(".lane-label").getBoundingClientRect(); return { x: Math.round(r.left + 6), y: Math.round(r.top + r.height / 2) }; })()`,
    );
  const laneY = () =>
    js(`(() => { const r = marksLane.getBoundingClientRect(); return Math.round(r.top + r.height / 2); })()`);
  // A press (and optional drag) at a given point, e.g. on a flag.
  async function pressAt(x1, y, x2 = x1, clickCount = 1) {
    wc.sendInputEvent({ type: "mouseDown", x: x1, y, button: "left", clickCount });
    for (let i = 1; i <= 6 && x2 !== x1; i++) {
      wc.sendInputEvent({ type: "mouseMove", x: Math.round(x1 + ((x2 - x1) * i) / 6), y, button: "left" });
      await sleep(20);
    }
    wc.sendInputEvent({ type: "mouseUp", x: x2, y, button: "left", clickCount });
    await sleep(150);
  }

  await openFile(path.join(FIXTURES, "tone.wav"));
  await ensurePaused();
  check(
    "no marks at first: the list shows how to make one",
    (await listed()).length === 0 && (await js(`!document.getElementById("marksEmpty").hidden`)),
  );
  check(
    "the legend lists the mark keys",
    (await js(`document.getElementById("shortcutList").textContent`)).includes("Shift+→Next mark"),
  );
  // The shortcuts dialog: the ? button and the ? key open it, Esc closes it.
  await js(`helpButton.click()`);
  await sleep(100);
  const helpShown = await js(`shortcutsDialog.open && document.querySelector("#shortcutList li").checkVisibility()`);
  key("Escape");
  await sleep(100);
  const helpClosed = !(await js(`shortcutsDialog.open`));
  key("/", ["shift"]);
  await sleep(100);
  check(
    "? (button or key) shows the shortcuts; Esc closes them",
    helpShown && helpClosed && (await js(`shortcutsDialog.open`)),
  );
  await js(`shortcutsDialog.close()`);

  // M: a point at the cursor, drawn, listed, selected.
  await click(3);
  key("M");
  await sleep(150);
  let marks = await listed();
  check(
    "M marks a point at the cursor, listed and selected",
    marks.length === 1 && marks[0].name === "Mark 1" && near(marks[0].start, 3) && marks[0].selected,
    JSON.stringify(marks),
  );
  check(
    "…drawn in the lane with its flag and on the minimap, with no line over the waveform",
    (await drawn(".lane-point")) === 1 &&
      (await js(`document.querySelector("#marksLane .lane-label").textContent`)) === "Mark 1" &&
      (await js(`document.querySelectorAll("#timelineGuides .guide-mark").length`)) === 0 &&
      (await js(`document.querySelectorAll("#waveform-minimap .minimap-mark").length`)) === 1,
  );
  check("the empty hint is gone", await js(`document.getElementById("marksEmpty").hidden`));

  // M while playing: where it was heard.
  await click(1);
  key("Space");
  await sleep(700);
  const before = await pos();
  key("M");
  const after = await pos();
  await ensurePaused();
  const tapped = await byName("Mark 2");
  check(
    "M while playing marks where it was heard",
    tapped && tapped.start >= before - 0.1 && tapped.start <= after + 0.02,
    `${before}…${after}: ${tapped?.start}`,
  );

  // R … R: a region, drawn dashed while it's being marked.
  await click(6);
  key("R");
  await sleep(100);
  check("R starts a region, drawn while it's marked", (await drawn(".pending")) === 1);
  await click(9);
  key("R");
  await sleep(150);
  let region = await byName("Region 1");
  check(
    "R again ends it there",
    region && near(region.start, 6) && near(region.end, 9) && region.selected,
    JSON.stringify(region),
  );
  check(
    "…a region in the lane and on the minimap, nothing pending",
    (await drawn(".lane-region")) === 1 &&
      (await drawn(".pending")) === 0 &&
      (await js(`document.querySelectorAll("#waveform-minimap .minimap-region").length`)) === 1,
  );

  await click(11);
  key("R");
  await sleep(100);
  key("Escape");
  await sleep(100);
  check("Esc stops marking a region", (await drawn(".pending")) === 0 && (await listed()).length === 3);
  key("Escape");
  await sleep(100);
  check(
    "Esc again deselects",
    (await listed()).every((mark) => !mark.selected),
  );
  key("R");
  key("R");
  await sleep(150);
  check("R twice at one spot makes no region", (await listed()).length === 3);

  // Dragging: a point's flag moves it; a region's edge moves that edge.
  const mark1 = await byName("Mark 1");
  let flag = await flagBox(mark1.id);
  await pressAt(flag.x, flag.y, flag.x + ((await xAt(4)) - (await xAt(3))));
  check("dragging a flag moves the mark", near((await byName("Mark 1")).start, 4), (await byName("Mark 1")).start);
  await pressAt(await xAt(9), await laneY(), await xAt(10));
  region = await byName("Region 1");
  check(
    "dragging a region's edge moves that edge",
    near(region.start, 6) && near(region.end, 10),
    JSON.stringify(region),
  );
  flag = await flagBox(region.id);
  await pressAt(flag.x, flag.y, flag.x + ((await xAt(7)) - (await xAt(6))));
  region = await byName("Region 1");
  check(
    "dragging a region's flag moves all of it",
    near(region.start, 7) && near(region.end, 11),
    JSON.stringify(region),
  );

  // Clicks: inside a region still seeks; a flag seeks to its mark.
  await click(9);
  check("a click inside a region still seeks", near(await pos(), 9, 0.05), await pos());
  flag = await flagBox(region.id);
  await pressAt(flag.x, flag.y);
  check(
    "clicking a flag selects its mark and goes there",
    near(await pos(), region.start, 0.002) && (await byName("Region 1")).selected,
    await pos(),
  );

  // Shift+← / Shift+→ go from mark to mark.
  await click(0);
  marks = await listed();
  key("Right", ["shift"]);
  await sleep(150);
  const first = await pos();
  key("Right", ["shift"]);
  await sleep(150);
  const second = await pos();
  key("Left", ["shift"]);
  await sleep(150);
  check(
    "Shift+→ / Shift+← go to the next and previous mark",
    near(first, marks[0].start, 0.002) && near(second, marks[1].start, 0.002) && near(await pos(), first, 0.002),
    `${first} ${second} ${await pos()} ${JSON.stringify(marks.map((mark) => mark.start))}`,
  );
  check("…selecting it", (await listed())[0].selected);

  // The list: rename, colour, go there.
  const name = `document.querySelector('#marksList [data-id="${region.id}"] .mark-name')`;
  await js(`${name}.focus(); ${name}.select()`);
  wc.insertText("Chorus");
  key("M"); // typed, not a shortcut
  await sleep(100);
  check("keys typed in a name aren't shortcuts", (await listed()).length === 3);
  key("Return");
  await sleep(150);
  check(
    "renaming in the list renames the flag",
    (await js(`${item(region.id)}.textContent`)) === "Chorus",
    await js(`${item(region.id)}.textContent`),
  );
  const colorOf = () => js(`${item(region.id)}.style.getPropertyValue("--mark-color")`);
  const colorBefore = await colorOf();
  await js(`document.querySelector('#marksList [data-id="${region.id}"] .mark-color').click()`);
  await sleep(100);
  check(
    "the colour button gives the next colour",
    (await colorOf()) !== colorBefore,
    `${colorBefore} → ${await colorOf()}`,
  );
  await js(`document.querySelector('#marksList [data-id="${region.id}"] .mark-time').click()`);
  await sleep(150);
  check("the time in the list goes there", near(await pos(), region.start, 0.002), await pos());

  // A double-click on a flag: the name, ready to type.
  flag = await flagBox(mark1.id);
  await pressAt(flag.x, flag.y);
  await pressAt(flag.x, flag.y, flag.x, 2);
  check(
    "double-clicking a flag edits its name",
    await js(`document.activeElement === document.querySelector('#marksList [data-id="${mark1.id}"] .mark-name')`),
  );
  key("Escape");
  await sleep(100);
  await shot("marks.png");
  check(
    "the waveform itself holds no markers (only the loop and the hover line)",
    (await js(`${shadow}.querySelectorAll('[part~="mark"], [part~="mark-flag"], [part~="start-point"]').length`)) === 0,
  );

  // Delete / Backspace: the selected mark.
  flag = await flagBox(mark1.id);
  await pressAt(flag.x, flag.y);
  key("Delete");
  await sleep(150);
  check(
    "Delete deletes the selected mark",
    !(await byName("Mark 1")) && (await listed()).length === 2 && (await drawn(".lane-point")) === 1,
  );
  await js(`document.querySelector('#marksList .mark-remove').click()`);
  await sleep(150);
  check("× in the list deletes that mark", (await listed()).length === 1);

  // Zoomed in, a mark stays at its time.
  const zoomed = (await rect()).width;
  wc.sendInputEvent({ type: "mouseWheel", x: await xAt(7), y: Math.round((await rect()).y), deltaX: 0, deltaY: 600 });
  await sleep(300);
  const remaining = (await listed())[0];
  const flagX = await js(`${item(remaining.id)}.getBoundingClientRect().left`);
  check(
    "marks follow the zoom",
    (await rect()).width > zoomed && Math.abs(flagX - (await xAt(remaining.start))) <= 2,
    `${flagX} vs ${await xAt(remaining.start)}`,
  );

  // Many marks: the list scrolls inside the sidebar; the page never grows.
  wc.sendInputEvent({ type: "mouseWheel", x: await xAt(7), y: Math.round((await rect()).y), deltaX: 0, deltaY: -6000 });
  await sleep(300); // back to the whole track (zoomed in above)
  for (let i = 0; i < 24; i++) {
    await click(0.4 + i * 0.75);
    key("M");
  }
  await sleep(200);
  check(
    "many marks scroll in the sidebar, and the page doesn't grow",
    (await listed()).length >= 24 &&
      (await js(`marksList.scrollHeight > marksList.clientHeight`)) &&
      (await js(`document.scrollingElement.scrollHeight <= window.innerHeight`)),
    [
      (await listed()).length,
      ...(await js(
        `[marksList.scrollHeight, marksList.clientHeight, document.scrollingElement.scrollHeight, innerHeight]`,
      )),
    ],
  );
  const countBefore = (await listed()).length;
  await js(`addPoint.click()`);
  await sleep(100);
  check("the sidebar's Point button marks a point", (await listed()).length === countBefore + 1);

  // The transport: Play shows only its icon (its label is for screen
  // readers); the step size sits between the step arrows.
  check(
    "Play is just an icon; the step size is between its arrows",
    await js(`(() => {
      const box = (id) => document.getElementById(id).getBoundingClientRect();
      return play.offsetWidth <= 44 && playLabel.getBoundingClientRect().width <= 1 &&
        box("stepBack").right <= box("stepSize").left && box("stepSize").right <= box("stepForward").left;
    })()`),
    await js(
      `[play.offsetWidth, playLabel.getBoundingClientRect().width, ...["stepBack", "stepSize", "stepForward"].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [r.left, r.right]; })]`,
    ),
  );

  // Half a screen (960 px wide): the sidebar stays in view beside the
  // timeline, and nothing spills sideways.
  const [width, height] = h.win.getSize();
  h.win.setSize(960, height);
  await sleep(400);
  const half = await js(`(() => {
    const side = sidebar.getBoundingClientRect(), wave = document.getElementById("waveform").getBoundingClientRect();
    return { visible: sidebar.checkVisibility(), beside: side.left >= wave.right, inside: side.right <= innerWidth,
      noSpill: document.scrollingElement.scrollWidth <= innerWidth, width: Math.round(side.width) };
  })()`);
  check(
    "half a screen: the sidebar stays in view beside the timeline",
    half.visible && half.beside && half.inside && half.noSpill,
    JSON.stringify(half),
  );
  h.win.setSize(width, height);
  await sleep(400);

  // Another file: no marks.
  await openFile(path.join(FIXTURES, "long-chirp.m4a"));
  check(
    "a new file starts without marks",
    (await listed()).length === 0 &&
      (await drawn(".lane-mark")) === 0 &&
      (await js(`document.querySelectorAll("#timelineGuides .guide-mark").length`)) === 0 &&
      (await js(`document.querySelectorAll("#waveform-minimap .minimap-mark").length`)) === 0,
  );
};
