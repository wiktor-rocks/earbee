// Marks: the actions on them (their keys are in SHORTCUTS, app.js; the
// sidebar's Point and Region buttons do M and R), the selected mark, the
// region being marked, and the marks list in the sidebar. The marks
// themselves are in the store (`marks`, context.js; src/marks); the
// timeline draws them in its lane and reports drags on them (timeline.js).
// Every change to the store redraws both views.
import { CONFIG } from "../config.js";
import { marks, player } from "../context.js";
import { formatTrackTime } from "../core/format.js";
import { MAX_LABEL_LENGTH } from "../marks/index.js";
import { MARK_COLORS } from "../themes/index.js";
import { dom, element, onClick } from "../ui/dom.js";

/** @typedef {import("../marks/index.js").Mark} Mark */

let selected = null; // the selected mark's id
let pendingStart = null; // after R once: where the region being marked starts
// The list's rows, by mark id, kept between renders so typing in a name
// isn't interrupted.
/** @type {Map<string, ReturnType<typeof buildRow>>} */
const rows = new Map();

/* ---------- Drawing ---------- */

function drawMarks() {
  const pending = pendingStart === null ? null : { start: pendingStart, end: player.transport.position };
  player.timeline.setMarks(marks.list(), { selected, pending });
}

function show() {
  drawMarks();
  renderList();
}

/* ---------- Actions ---------- */

/** @param {string | null} id */
export function selectMark(id) {
  selected = id && marks.get(id) ? id : null;
  show();
  if (selected) rows.get(selected)?.row.scrollIntoView({ block: "nearest" });
}

/** @param {Mark} mark */
function goTo(mark) {
  player.transport.seek(mark.start);
  selectMark(mark.id);
}

// A new track: no marks, or the ones a project saved (marks.toJSON()'s
// form; throws a MarksFormatError if they can't be read), and nothing
// selected or being marked.
/** @param {number} duration @param {unknown} [saved] */
export function resetMarks(duration, saved) {
  selected = null;
  pendingStart = null;
  marks.reset(duration, saved);
}

/**
 * A downloaded video's chapters, as regions named after them, in turn
 * through the mark colours so neighbours (which meet end to start) are
 * told apart. The store keeps them inside the track and drops ones too
 * short. Returns how many were added.
 * @param {{ start: number, end: number, title: string }[]} chapters
 */
export function importChapters(chapters) {
  let added = 0;
  for (const { start, end, title } of chapters) {
    const color = MARK_COLORS[added % MARK_COLORS.length].id;
    if (marks.addRegion(start, end, { label: title, color })) added++;
  }
  return added;
}

// M: a point where it was heard (the key's own time, so tapping along
// while it plays lands on the beat).
/** @param {KeyboardEvent} event */
export function markPoint(event) {
  selectMark(marks.addPoint(player.transport.positionAt(event.timeStamp)).id);
}

// R: starts a region; R again ends it there (too short: nothing).
/** @param {KeyboardEvent} event */
export function markRegion(event) {
  const time = player.transport.positionAt(event.timeStamp);
  if (pendingStart === null) {
    pendingStart = time;
    drawMarks();
    return;
  }
  const region = marks.addRegion(pendingStart, time);
  pendingStart = null;
  if (region) selectMark(region.id);
  else drawMarks();
}

// Shift+← / Shift+→. While playing, "previous" skips a mark just passed,
// so pressing it twice goes back two.
/** @param {KeyboardEvent} event */
export function previousMark(event) {
  const { transport } = player;
  const tolerance = transport.playing ? CONFIG.marks.jumpBackSeconds : 0;
  const mark = marks.previous(transport.positionAt(event.timeStamp), tolerance);
  if (mark) goTo(mark);
}

/** @param {KeyboardEvent} event */
export function nextMark(event) {
  const mark = marks.next(player.transport.positionAt(event.timeStamp));
  if (mark) goTo(mark);
}

export function deleteSelectedMark() {
  if (selected) marks.remove(selected);
}

// Esc: stops marking a region, or else deselects.
export function cancelMarking() {
  if (pendingStart !== null) pendingStart = null;
  else selected = null;
  show();
}

/**
 * A drag in the timeline's marks lane moved a mark.
 * @param {string} id @param {{ start: number, end: number | null }} times
 */
export const moveMark = (id, times) => marks.update(id, times);

/** A double-click on a mark's flag: its name, ready to type. @param {string} id */
export function renameMark(id) {
  selectMark(id);
  const name = rows.get(id)?.name;
  name?.focus();
  name?.select();
}

/* ---------- The list ---------- */

const colorName = (id) => MARK_COLORS.find((color) => color.id === id)?.name ?? id;

/** @param {string} id */
function buildRow(id) {
  const color = element("button", { type: "button", className: "mark-color" });
  const name = element("input", { type: "text", className: "mark-name", maxLength: MAX_LABEL_LENGTH });
  name.spellcheck = false;
  name.setAttribute("aria-label", "Name");
  const time = element("button", { type: "button", className: "mark-time" });
  time.title = "Go there";
  const remove = element("button", { type: "button", className: "small mark-remove" }, "×");
  remove.title = "Delete this mark";
  remove.setAttribute("aria-label", "Delete");
  const row = element("li", { className: "mark-row" }, color, name, time, remove);
  row.dataset.id = id;

  onClick(color, () => {
    const index = MARK_COLORS.findIndex((each) => each.id === marks.get(id)?.color);
    marks.update(id, { color: MARK_COLORS[(index + 1) % MARK_COLORS.length].id });
    selectMark(id);
  });
  name.addEventListener("focus", () => selected !== id && selectMark(id));
  name.addEventListener("change", () => marks.update(id, { label: name.value }));
  // Enter keeps the name, Esc puts the old one back; both leave the field.
  name.addEventListener("keydown", (event) => {
    if (event.key === "Escape") name.value = marks.get(id)?.label ?? "";
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      name.blur();
    }
  });
  onClick(time, () => {
    const mark = marks.get(id);
    if (mark) goTo(mark);
  });
  onClick(remove, () => marks.remove(id));
  return { row, color, name, time };
}

function renderList() {
  const list = marks.list();
  const kept = new Set(list.map((mark) => mark.id));
  for (const [id, { row }] of rows) {
    if (kept.has(id)) continue;
    row.remove();
    rows.delete(id);
  }

  for (const mark of list) {
    if (!rows.has(mark.id)) rows.set(mark.id, buildRow(mark.id));
    const { row, color, name, time } = rows.get(mark.id);
    row.classList.toggle("selected", mark.id === selected);
    row.ariaCurrent = mark.id === selected ? "true" : null;
    color.style.setProperty("--mark-color", `var(--mark-${mark.color})`);
    color.title = `Colour: ${colorName(mark.color)} (click for the next)`;
    color.setAttribute("aria-label", color.title);
    if (document.activeElement !== name) name.value = mark.label;
    time.textContent =
      mark.end === null ? formatTrackTime(mark.start) : `${formatTrackTime(mark.start)} – ${formatTrackTime(mark.end)}`;
  }

  // In time order. Only moved when the order changed: moving a row would
  // take the focus out of its name field.
  const order = list.map((mark) => rows.get(mark.id).row);
  if (order.some((row, i) => dom.marksList.children[i] !== row)) dom.marksList.replaceChildren(...order);
  dom.marksEmpty.hidden = list.length > 0;
  dom.marksCount.textContent = list.length ? String(list.length) : "";
}

export function bindMarks() {
  // The sidebar's buttons do what M and R do.
  onClick(dom.addPointButton, markPoint);
  onClick(dom.addRegionButton, markRegion);
  marks.on("change", () => {
    if (selected && !marks.get(selected)) selected = null;
    show();
  });
  // The region being marked grows with the cursor.
  player.transport.on("position", () => pendingStart !== null && drawMarks());
  renderList();
}
