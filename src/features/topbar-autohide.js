/* =====================================================================
 * TOP BAR AUTOHIDE
 * Settings › Layout › Hide the top bar: the bar slides away and its room
 * goes to the stage and the side panel, once. It slides back over them
 * when the pointer reaches the window's top edge with no button held (so
 * a drag up there doesn't bring it), stays while the pointer is on it, and
 * goes a moment after the pointer is off it: below it, or out of the
 * window (CONFIG.layout). While it's in use, with one of its
 * menus open or focus in it, CSS keeps it shown (style.css, "Top bar").
 * Only `transform` changes as it comes and goes, so nothing under it is
 * laid out or redrawn again. Off: the bar is back in the layout.
 * ===================================================================== */

import { CONFIG } from "../config.js";
import { dom } from "../ui/dom.js";
import { getPrefs, onPrefsChange } from "../ui/prefs.js";

const bar = () => /** @type {HTMLElement} */ (dom.app.querySelector(".topbar"));
let on = false;
let hideTimer = 0;
let pointerY = Infinity; // the pointer's height in the window; Infinity when it's outside

// Whether the pointer is where the bar is when shown (its own height; the
// slide's transform doesn't change that). Tracked here rather than read
// from :hover, which a bar sliding in under a still pointer doesn't get.
const pointerOnBar = () => pointerY <= bar().offsetHeight;

function hideSoon() {
  if (hideTimer) return;
  hideTimer = window.setTimeout(() => {
    hideTimer = 0;
    if (!pointerOnBar()) bar().classList.remove("revealed");
  }, CONFIG.layout.topbarHideMs);
}

function stayShown() {
  clearTimeout(hideTimer);
  hideTimer = 0;
}

// At the top edge: shown. While shown, it stays as long as the pointer is
// on it, and goes a moment after the pointer is off it.
/** @param {PointerEvent} event */
function onPointerMove(event) {
  pointerY = event.clientY;
  if (event.buttons === 0 && pointerY <= CONFIG.layout.topbarRevealPx) bar().classList.add("revealed");
  if (!bar().classList.contains("revealed")) return;
  if (pointerOnBar()) stayShown();
  else hideSoon();
}

// The pointer out of the window: off the bar too.
/** @param {PointerEvent} event */
function onPointerOut(event) {
  if (event.relatedTarget) return;
  pointerY = Infinity;
  if (bar().classList.contains("revealed")) hideSoon();
}

/** @param {Record<string, any>} layout Settings › Layout's values. */
function apply(layout) {
  if (Boolean(layout.autohideTopBar) === on) return;
  on = Boolean(layout.autohideTopBar);
  dom.app.classList.toggle("topbar-autohide", on);
  const method = on ? "addEventListener" : "removeEventListener";
  document[method]("pointermove", onPointerMove);
  document[method]("pointerout", onPointerOut);
  if (!on) {
    stayShown();
    bar().classList.remove("revealed");
  }
}

export function bindTopbarAutohide() {
  apply(getPrefs("layout"));
  onPrefsChange("layout", apply);
}
