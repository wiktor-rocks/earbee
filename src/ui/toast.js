/* =====================================================================
 * NOTIFICATIONS
 * Small messages at the bottom of the window that confirm something
 * worked: a project saved, a download saved, a file opened. Each fades
 * after CONFIG.notifications.showMs; a click dismisses it sooner.
 *
 * Only for confirmations. Problems go to the message line (showNotice,
 * reportError in ui/dom.js), so turning these off (Settings › General)
 * or one failing loses nothing that matters: notify() never throws.
 * ===================================================================== */

import { CONFIG } from "../config.js";
import { element } from "./dom.js";
import { getPrefs } from "./prefs.js";

/** @type {HTMLElement | null} */
let host = null;

function dismiss(toast) {
  if (toast.classList.contains("leaving")) return;
  toast.classList.add("leaving");
  // After the fade (none with reduced motion, so also on a timer).
  toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  setTimeout(() => toast.remove(), 400);
}

/**
 * Shows `text`, with `detail` (e.g. a file's path) on a second line.
 * @param {string} text
 * @param {string} [detail]
 */
export function notify(text, detail) {
  try {
    if (getPrefs("general")?.notifications === false) return;
    if (!host?.isConnected) {
      host = element("div", { className: "toasts", role: "status" });
      host.setAttribute("aria-live", "polite");
      document.body.append(host);
    }
    const toast = element("div", { className: "toast" }, element("span", {}, text));
    if (detail) toast.append(element("small", {}, detail));
    toast.addEventListener("click", () => dismiss(toast));
    host.append(toast);

    const shown = [...host.querySelectorAll(".toast:not(.leaving)")];
    for (const old of shown.slice(0, Math.max(0, shown.length - CONFIG.notifications.max))) dismiss(old);
    setTimeout(() => dismiss(toast), CONFIG.notifications.showMs);
  } catch (error) {
    console.warn("Couldn't show a notification:", error);
  }
}
