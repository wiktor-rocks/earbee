/* =====================================================================
 * NOTIFICATIONS
 * Every message the app shows, in one place with one look: a stack of
 * cards in the bottom-right corner, just above the transport (the
 * window's corner on the welcome screen). Three kinds:
 *   done    a confirmation: a project saved, a file opened (notify()).
 *           Fades after CONFIG.notifications.showMs. Settings › General ›
 *           Show notifications turns these off.
 *   notice  something works only partly (showNotice in ui/dom.js).
 *   error   something failed (reportError in ui/dom.js).
 * A notice or an error stays until it's closed or the next one replaces
 * it: there's only ever one. A click on any card removes it at once.
 *
 * Every message is also logged, kept between runs in the browser's
 * storage, for Settings › Notifications (features/notification-log.js).
 * Nothing here throws: a message that can't be shown is only logged to
 * the console.
 * ===================================================================== */

import { CONFIG } from "../config.js";
import { createEmitter } from "../core/emitter.js";
import { appendEntry, parseLog } from "../core/notification-log.js";
import { getPrefs } from "./prefs.js";
import { readStored, store } from "./storage.js";

/** @typedef {import("../core/notification-log.js").NoticeKind} NoticeKind */
/** @typedef {import("../core/notification-log.js").LogEntry} LogEntry */

const LOG_KEY = "earbee.notificationLog";
const MARKS = { done: "✓", notice: "i", error: "!" };

/** @type {HTMLElement | null} */
let host = null;
/** The notice or error showing, if any. @type {HTMLElement | null} */
let standing = null;

function stack() {
  if (host?.isConnected) return host;
  host = document.getElementById("notices");
  if (!host) {
    host = document.createElement("div");
    host.id = "notices";
    host.className = "notices";
    host.setAttribute("aria-live", "polite");
    document.body.append(host);
  }
  return host;
}

/** @param {string} tag @param {string} className @param {string} [text] */
function make(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * A card: the kind's mark, the text, and `detail` (e.g. a file's path) on
 * a second line. A click anywhere on it removes it.
 * @param {NoticeKind} kind @param {string} text @param {string} [detail]
 */
function card(kind, text, detail) {
  const toast = make("div", `toast toast-${kind}`);
  toast.dataset.kind = kind;
  if (kind === "error") toast.setAttribute("role", "alert");
  const body = make("div", "toast-body");
  body.append(make("span", "toast-text", text));
  if (detail) body.append(make("small", "toast-detail", detail));
  toast.append(make("span", "toast-mark", MARKS[kind]), body);
  if (kind !== "done") {
    const close = make("button", "toast-close icon-button", "×");
    close.setAttribute("type", "button");
    close.setAttribute("aria-label", "Close");
    toast.append(close);
  }
  toast.addEventListener("click", () => remove(toast));
  return toast;
}

/** At once: a click shouldn't wait for an animation. @param {HTMLElement} toast */
function remove(toast) {
  toast.remove();
  if (toast === standing) standing = null;
}

/** With a short fade, when its time is up. @param {HTMLElement} toast */
function fadeOut(toast) {
  if (!toast.isConnected || toast.classList.contains("leaving")) return;
  toast.classList.add("leaving");
  // After the fade (none with reduced motion, so also on a timer).
  toast.addEventListener("transitionend", () => remove(toast), { once: true });
  setTimeout(() => remove(toast), 400);
}

// At most CONFIG.notifications.max cards: the oldest confirmations give
// way (never the notice or error).
function trim() {
  const shown = [...stack().querySelectorAll(".toast:not(.leaving)")];
  let extra = shown.length - CONFIG.notifications.max;
  for (const old of shown) {
    if (extra <= 0) break;
    if (old === standing) continue;
    remove(/** @type {HTMLElement} */ (old));
    extra--;
  }
}

/* ---------- The log ---------- */

const changes = createEmitter();
/** @type {LogEntry[] | null} */
let log = null;

const loadLog = () => (log ??= parseLog(readStored(LOG_KEY), CONFIG.notifications.logMax));

/** @param {NoticeKind} kind @param {string} text @param {string} [detail] */
function record(kind, text, detail) {
  try {
    /** @type {LogEntry} */
    const entry = { time: Date.now(), kind, text };
    if (detail) entry.detail = detail;
    log = appendEntry(loadLog(), entry, CONFIG.notifications.logMax);
    store(LOG_KEY, JSON.stringify(log));
    changes.emit("change");
  } catch (error) {
    console.warn("Couldn't log a notification:", error);
  }
}

/** Oldest first. @returns {readonly LogEntry[]} */
export const notificationLog = () => loadLog();

export function clearNotificationLog() {
  log = [];
  store(LOG_KEY, "[]");
  changes.emit("change");
}

/** @param {() => void} listener @returns {() => void} unsubscribe */
export const onLogChange = (listener) => changes.on("change", listener);

/* ---------- Showing them ---------- */

/**
 * A confirmation that something worked, with `detail` (e.g. a file's
 * path) on a second line.
 * @param {string} text
 * @param {string} [detail]
 */
export function notify(text, detail) {
  record("done", text, detail);
  try {
    if (getPrefs("general")?.notifications === false) return;
    const toast = card("done", text, detail);
    // Above the notice or error, which stays at the bottom.
    if (standing?.isConnected) stack().insertBefore(toast, standing);
    else stack().append(toast);
    trim();
    setTimeout(() => fadeOut(toast), CONFIG.notifications.showMs);
  } catch (error) {
    console.warn("Couldn't show a notification:", error);
  }
}

/**
 * The notice or error, in place of the one showing; empty `text` only
 * removes that one (a load that went fine clears an earlier problem).
 * @param {string} text
 * @param {"notice" | "error"} kind
 */
export function showMessage(text, kind) {
  try {
    if (standing) remove(standing);
    if (!text) return;
    record(kind, text);
    standing = card(kind, text);
    stack().append(standing);
    trim();
  } catch (error) {
    console.warn("Couldn't show a message:", error, text);
  }
}
