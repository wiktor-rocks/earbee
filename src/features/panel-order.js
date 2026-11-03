/* =====================================================================
 * PANEL ORDER
 * The side panel's sections (Speed, Pitch, Mixer, EQ, Beats, Points,
 * Loop and Marks) in the order the user likes: drag a section by its
 * grip (on its left edge) and drop it higher or lower;
 * with the grip focused, ↑ and ↓ move it one place.
 *
 *   How        The sections are found in the page as they are: each
 *              .dock-group (keyed by its "<key>-group" class) and the
 *              marks (#sidebar, "marks"); nothing in index.html knows
 *              about this. The sound sections above the marks stay in
 *              the dock; those below go into a second dock made here
 *              (.dock-below). The whole panel scrolls as one, and the
 *              marks' list inside its section. Moving a section moves
 *              its element, so every listener stays with it.
 *   Saved      On this computer (browser storage), not in projects. A
 *              section the saved order doesn't know goes back to its
 *              place in the default order.
 *   Hidden     A section hidden in Settings › Layout (panel-sections.js)
 *              keeps its place in the order; dropping and ↑ / ↓ skip it.
 *
 * Removing it means deleting this file, its part in style.css ("Panel
 * order") and the lines marked "Panel order (".
 * ===================================================================== */

import { $, element } from "../ui/dom.js";
import { readStored, store } from "../ui/storage.js";

const ORDER_KEY = "earbee.panelOrder";
const MARKS = "marks";
// A press that moves less than this is a click, not a drag.
const DRAG_THRESHOLD = 4;
// Near the panel's top or bottom edge (px), a drag scrolls it, up to
// SCROLL_SPEED px a frame.
const SCROLL_EDGE = 32;
const SCROLL_SPEED = 10;

const GRIP_ICON =
  '<svg class="icon" viewBox="0 0 8 14" aria-hidden="true">' +
  [3, 7, 11].map((y) => `<circle cx="2" cy="${y}" r="1.1"/><circle cx="6" cy="${y}" r="1.1"/>`).join("") +
  "</svg>";

const panel = $("panel");
const upper = /** @type {HTMLElement} */ (panel.querySelector(".dock"));
const sidebar = $("sidebar");
const lower = element("section", { className: "dock dock-below", ariaLabel: "Sound, below the marks" });

/** @type {Map<string, HTMLElement>} */
const sections = new Map();
/** @type {string[]} */
let defaultOrder = [];
/** @type {string[]} */
let order = [];

/** A dock group's key: "speed" for .speed-group. @param {HTMLElement} group */
const keyOf = (group) =>
  [...group.classList].find((name) => name !== "dock-group" && name.endsWith("-group"))?.slice(0, -6);

/**
 * The saved order made to fit the sections there are: unknown keys
 * dropped, missing ones put back after their default neighbour above.
 * @param {unknown} saved @param {string[]} defaults
 */
function fitOrder(saved, defaults) {
  const list = Array.isArray(saved) ? saved : [];
  const fitted = list.filter((key, i) => defaults.includes(key) && list.indexOf(key) === i);
  defaults.forEach((key, i) => {
    if (!fitted.includes(key)) fitted.splice(i === 0 ? 0 : fitted.indexOf(defaults[i - 1]) + 1, 0, key);
  });
  return fitted;
}

function readOrder() {
  try {
    return fitOrder(JSON.parse(readStored(ORDER_KEY) ?? "null"), defaultOrder);
  } catch {
    return [...defaultOrder];
  }
}

// Puts the sections in `next`'s order: the sound sections before the
// marks in the dock, those after them in the dock below. The panel and
// the marks' list keep where they were scrolled to.
function layout(next) {
  const marksList = $("marksList");
  const scrolled = [panel, marksList].map((part) => part.scrollTop);
  const at = next.indexOf(MARKS);
  upper.append(...next.slice(0, at).map((key) => sections.get(key)));
  upper.after(sidebar);
  lower.append(...next.slice(at + 1).map((key) => sections.get(key)));
  [panel, marksList].forEach((part, i) => (part.scrollTop = scrolled[i]));
  order = next;
}

/** `key` moved to before the section now at `gap` (the end: order.length). @param {string} key @param {number} gap */
function moveTo(key, gap) {
  const from = order.indexOf(key);
  if (gap === from || gap === from + 1) return false;
  const next = order.filter((other) => other !== key);
  next.splice(gap > from ? gap - 1 : gap, 0, key);
  layout(next);
  store(ORDER_KEY, JSON.stringify(order));
  return true;
}

// Back to the order in index.html (the tests use it).
export function resetPanelOrder() {
  layout([...defaultOrder]);
  store(ORDER_KEY, JSON.stringify(order));
}

const isShown = (part) => part.getClientRects().length > 0;

/**
 * Where a section dropped at the pointer's `y` would go: the gap (the
 * index in `order` it would come before) and that seam's height on the
 * screen, kept within the visible part it's in.
 * @param {number} y
 */
function dropAt(y) {
  const parts = [upper, sidebar, lower].filter(isShown);
  const first = parts[0].getBoundingClientRect();
  const last = parts.at(-1).getBoundingClientRect();
  if (y < first.top) return { gap: 0, y: first.top };
  const part = parts.find((candidate) => y < candidate.getBoundingClientRect().bottom);
  if (!part) return { gap: order.length, y: last.bottom };
  const box = part.getBoundingClientRect();
  const within = (edge) => Math.min(Math.max(edge, box.top), box.bottom);
  if (part === sidebar) {
    const after = y > box.top + box.height / 2;
    return { gap: order.indexOf(MARKS) + (after ? 1 : 0), y: after ? box.bottom : box.top };
  }
  const groups = /** @type {HTMLElement[]} */ ([...part.children]).filter(isShown);
  for (const group of groups) {
    const rect = group.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) return { gap: order.indexOf(keyOf(group)), y: within(rect.top) };
  }
  const end = groups.at(-1).getBoundingClientRect();
  return { gap: order.indexOf(keyOf(groups.at(-1))) + 1, y: within(end.bottom) };
}

/** The panel scrolls while the pointer is near its edge. @param {number} y */
function scrollNear(y) {
  if (panel.scrollHeight <= panel.clientHeight) return;
  const box = panel.getBoundingClientRect();
  if (y < box.top + SCROLL_EDGE) panel.scrollTop -= SCROLL_SPEED * Math.min(1 - (y - box.top) / SCROLL_EDGE, 1);
  else if (y > box.bottom - SCROLL_EDGE)
    panel.scrollTop += SCROLL_SPEED * Math.min(1 - (box.bottom - y) / SCROLL_EDGE, 1);
}

/** @param {string} key @param {HTMLButtonElement} grip */
function bindDrag(key, grip) {
  const section = sections.get(key);
  const line = /** @type {HTMLElement} */ (panel.querySelector(".panel-drop-line"));
  let startY = 0;
  let pointerY = 0;
  let dragging = false;
  let frame = 0;
  let drop = { gap: -1, y: 0 };

  // While dragging, every frame: scroll near an edge, then show where the
  // section would land.
  function tick() {
    scrollNear(pointerY);
    drop = dropAt(pointerY);
    // The line is placed in the panel's scrolled content; it stays within
    // the part in view.
    const top = drop.y - panel.getBoundingClientRect().top + panel.scrollTop - 1;
    const shownTop = panel.scrollTop;
    line.style.top = `${Math.min(Math.max(top, shownTop), shownTop + panel.clientHeight - 2)}px`;
    frame = requestAnimationFrame(tick);
  }

  function onMove(event) {
    pointerY = event.clientY;
    if (dragging || Math.abs(pointerY - startY) < DRAG_THRESHOLD) return;
    dragging = true;
    section.classList.add("panel-dragging");
    document.body.classList.add("panel-order-dragging");
    line.hidden = false;
    tick();
  }

  // Moves, the release and Esc are followed on the window, so a drag goes
  // on wherever the pointer goes.
  function end(apply) {
    cancelAnimationFrame(frame);
    if (dragging && apply) moveTo(key, drop.gap);
    dragging = false;
    section.classList.remove("panel-dragging");
    document.body.classList.remove("panel-order-dragging");
    line.hidden = true;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, { capture: true });
  }
  const onUp = () => end(true);
  const onCancel = () => end(false);
  function onKey(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    end(false);
  }

  grip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    startY = pointerY = event.clientY;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, { capture: true });
  });

  // ↑ and ↓ on the focused grip move the section one place (and not the
  // step size, as they do elsewhere).
  const onArrow = (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== "keydown") return;
    // One shown section up or down: past the hidden ones next to it.
    const at = order.indexOf(key);
    const up = event.key === "ArrowUp";
    let other = at;
    do other += up ? -1 : 1;
    while (other >= 0 && other < order.length && !isShown(sections.get(order[other])));
    if (other < 0 || other >= order.length) return;
    if (moveTo(key, up ? other : other + 1)) grip.focus();
  };
  grip.addEventListener("keydown", onArrow);
  grip.addEventListener("keyup", onArrow);
}

/** A section's grip, on its left edge. @param {string} key @param {string} name */
function makeGrip(key, name) {
  const grip = element("button", {
    type: "button",
    className: "panel-grip",
    title: "Drag to move this section (↑ ↓ when focused)",
    ariaLabel: `Move the ${name} section`,
  });
  grip.innerHTML = GRIP_ICON;
  bindDrag(key, grip);
  return grip;
}

export function bindPanelOrder() {
  for (const group of /** @type {NodeListOf<HTMLElement>} */ (upper.querySelectorAll(":scope > .dock-group"))) {
    const key = keyOf(group);
    if (key) sections.set(key, group);
  }
  sections.set(MARKS, sidebar);
  defaultOrder = [...sections.keys()];
  panel.append(lower, element("div", { className: "panel-drop-line", hidden: true }));

  for (const [key, section] of sections) {
    const name = section.querySelector("h2")?.textContent.trim() ?? key;
    const host = key === MARKS ? /** @type {HTMLElement} */ (sidebar.querySelector(".sidebar-head")) : section;
    host.prepend(makeGrip(key, name));
  }
  order = [...defaultOrder];
  const saved = readOrder();
  if (saved.join() !== order.join()) layout(saved);
}
