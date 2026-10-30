/* =====================================================================
 * TOP BAR AUTOHIDE
 * Settings › Layout › Hide the top bar: the bar slides away and its room
 * goes to the stage and the side panel, once. It slides back over them
 * when the pointer reaches the window's top edge with no button held (so
 * a drag up there doesn't bring it), and goes again only once the pointer
 * is off it: a moment after it leaves (CONFIG.layout), or after it reached
 * the edge without going onto the bar. While it's in use, with one of its
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

// Hidden after a moment, unless the pointer is on the bar by then (then
// its leaving starts this again).
function hideSoon() {
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (!bar().matches(":hover")) bar().classList.remove("revealed");
  }, CONFIG.layout.topbarHideMs);
}

// At the top edge: shown, and hidden again unless the pointer is on it.
/** @param {PointerEvent} event */
function onPointerMove(event) {
  if (event.buttons !== 0 || event.clientY > CONFIG.layout.topbarRevealPx) return;
  bar().classList.add("revealed");
  hideSoon();
}

/** @param {Record<string, any>} layout Settings › Layout's values. */
function apply(layout) {
  if (Boolean(layout.autohideTopBar) === on) return;
  on = Boolean(layout.autohideTopBar);
  dom.app.classList.toggle("topbar-autohide", on);
  const method = on ? "addEventListener" : "removeEventListener";
  document[method]("pointermove", onPointerMove);
  bar()[method]("pointerleave", hideSoon);
  if (!on) {
    clearTimeout(hideTimer);
    bar().classList.remove("revealed");
  }
}

export function bindTopbarAutohide() {
  apply(getPrefs("layout"));
  onPrefsChange("layout", apply);
}
