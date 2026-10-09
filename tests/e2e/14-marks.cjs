// Marks: points and regions made with the keys, drawn on the waveform and
// the minimap, listed under the controls, dragged, renamed, recoloured,
// jumped between and deleted; a new file starts without them.
// Part of the end-to-end run (see run.cjs); `h` is the harness.
const path = require("path");

module.exports = async function (h) {
  const { wc, js, openFile, key, xAt, rect, click, drag, shot, pos, ensurePaused, check, sleep, FIXTURES } = h;
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
  const drawn = (selector) => js(`${shadow}.querySelectorAll('${selector}').length`);
  const flagBox = (id) =>
    js(
      `(() => { const r = ${shadow}.querySelector('[data-mark-flag="${id}"]').getBoundingClientRect(); return { x: Math.round(r.left + 6), y: Math.round(r.top + r.height / 2) }; })()`,
    );
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
  const legendShown = () => js(`document.querySelector("#shortcutList li").checkVisibility()`);
  const legendClosed = !(await legendShown());
  await js(`shortcutsTitle.click()`);
  const legendOpened = await legendShown();
  await js(`shortcutsTitle.click()`);
  check("the legend's keys show only once it's opened", legendClosed && legendOpened && !(await legendShown()));

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
    "…drawn on the waveform with its flag, and on the minimap",
    (await drawn('[part~="mark-point"]')) === 1 &&
      (await js(`${shadow}.querySelector('[part~="mark-flag"]').textContent`)) === "Mark 1" &&
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
  check("R starts a region, drawn while it's marked", (await drawn('[part~="mark-pending"]')) === 1);
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
    "…a region on the waveform and the minimap, nothing pending",
    (await drawn('[part~="mark-region"]')) === 1 &&
      (await drawn('[part~="mark-pending"]')) === 0 &&
      (await js(`document.querySelectorAll("#waveform-minimap .minimap-region").length`)) === 1,
  );

  await click(11);
  key("R");
  await sleep(100);
  key("Escape");
  await sleep(100);
  check("Esc stops marking a region", (await drawn('[part~="mark-pending"]')) === 0 && (await listed()).length === 3);
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
  await drag(null, 10, [], await xAt(9));
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
    (await js(`${shadow}.querySelector('[data-mark-flag="${region.id}"]').textContent`)) === "Chorus",
    await js(`${shadow}.querySelector('[data-mark-flag="${region.id}"]').textContent`),
  );
  const colorOf = () =>
    js(
      `${shadow}.querySelector('[data-mark-flag="${region.id}"]').parentElement.style.getPropertyValue("--mark-color")`,
    );
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

  // Delete / Backspace: the selected mark.
  flag = await flagBox(mark1.id);
  await pressAt(flag.x, flag.y);
  key("Delete");
  await sleep(150);
  check(
    "Delete deletes the selected mark",
    !(await byName("Mark 1")) && (await listed()).length === 2 && (await drawn('[part~="mark-point"]')) === 1,
  );
  await js(`document.querySelector('#marksList .mark-remove').click()`);
  await sleep(150);
  check("× in the list deletes that mark", (await listed()).length === 1);

  // Zoomed in, a mark stays at its time.
  const zoomed = (await rect()).width;
  wc.sendInputEvent({ type: "mouseWheel", x: await xAt(7), y: Math.round((await rect()).y), deltaX: 0, deltaY: 600 });
  await sleep(300);
  const remaining = (await listed())[0];
  const flagX = (await flagBox(remaining.id)).x - 6;
  check(
    "marks follow the zoom",
    (await rect()).width > zoomed && Math.abs(flagX - (await xAt(remaining.start))) <= 2,
    `${flagX} vs ${await xAt(remaining.start)}`,
  );

  // Another file: no marks.
  await openFile(path.join(FIXTURES, "long-chirp.m4a"));
  check(
    "a new file starts without marks",
    (await listed()).length === 0 &&
      (await drawn('[part~="mark"]')) === 0 &&
      (await js(`document.querySelectorAll("#waveform-minimap .minimap-mark").length`)) === 0,
  );
};
