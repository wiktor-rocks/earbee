// Settings › Notifications: the master log. Every message the app has
// shown, and every problem behind the scenes (console warnings, uncaught
// errors, the main process's; ui/problems.js), kept between runs
// (ui/toast.js), newest first, with when it came. A tab of its own in the
// Settings dialog (features/settings.js), though it isn't a setting: so a
// message that went by too fast can be read again, and so a user can be
// told "open Settings › Notifications, press Copy" for a bug report. Copy
// puts the whole log on the clipboard as text, oldest first, under a line
// with EarBee's version and the system (core/notification-log.js
// formatLog). Clear empties it.
import { CONFIG } from "../config.js";
import { formatLog, stamp } from "../core/notification-log.js";
import { element, onClick } from "../ui/dom.js";
import { clearNotificationLog, notificationLog, onLogChange } from "../ui/toast.js";

const KIND_NAMES = { done: "Done", notice: "Notice", error: "Error", warning: "Behind the scenes" };
const MARKS = { done: "✓", notice: "i", error: "!", warning: "⚠" };

// "14:05" today, "17 Nov 14:05" before (and the year if it isn't this one).
/** @param {number} time */
function when(time) {
  const date = new Date(time);
  const now = new Date();
  const clock = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return clock;
  const day = date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
  return `${day} ${clock}`;
}

/** @param {string} detail */
function detailOf(detail) {
  const lines = detail.split("\n");
  // Longer (a stack): folded, its first line, and the rest on a click.
  if (lines.length <= CONFIG.notifications.foldedLines)
    return element("small", { className: "toast-detail", textContent: detail });
  return element(
    "details",
    { className: "notification-log-detail" },
    element("summary", { className: "toast-detail", textContent: lines[0] }),
    element("small", { className: "toast-detail", textContent: lines.slice(1).join("\n") }),
  );
}

/** @param {import("../core/notification-log.js").LogEntry} entry */
function row(entry) {
  const mark = element("span", { className: "toast-mark", textContent: MARKS[entry.kind] });
  mark.title = KIND_NAMES[entry.kind];
  const repeat = entry.repeat > 1 ? ` (×${entry.repeat})` : "";
  const body = element(
    "div",
    { className: "notification-log-body" },
    element("span", { textContent: entry.text + repeat }),
  );
  if (entry.detail) body.append(detailOf(entry.detail));
  const time = element("time", { className: "notification-log-time", textContent: when(entry.time) });
  time.dateTime = new Date(entry.time).toISOString();
  const item = element("li", { className: `notification-log-entry toast-${entry.kind}` }, mark, body, time);
  item.dataset.key = keyOf(entry);
  return item;
}

/** Which entry a row shows, to keep an opened detail open. @param {import("../core/notification-log.js").LogEntry} entry */
const keyOf = (entry) => `${entry.kind}|${entry.text}|${entry.detail?.length ?? 0}`;

const SYSTEMS = { linux: "Linux", win32: "Windows", darwin: "macOS (Darwin)" };

/**
 * The lines above a copied log: EarBee's version and the system (from the
 * main process), and when it was copied.
 * @returns {Promise<string[]>}
 */
async function header() {
  const bridge = /** @type {any} */ (window).earbee;
  let app = "EarBee";
  try {
    const info = await bridge?.appInfo();
    if (info) {
      const system = `${SYSTEMS[info.platform] ?? info.platform} ${info.osRelease} (${info.arch})`;
      app = `EarBee ${info.version} · ${system} · Electron ${info.electron} · Chrome ${info.chrome}`;
    }
  } catch {
    // No main process to ask: the browser's own description, below.
  }
  if (app === "EarBee") app = `EarBee · ${navigator.userAgent}`;
  return [app, `Copied ${stamp(Date.now())}, from Settings › Notifications (oldest first)`];
}

/**
 * The tab's panel, kept up to date while the app runs.
 * @param {string} id the panel's id (the tab points at it)
 */
export function buildNotificationLog(id) {
  const list = element("ol", { className: "notification-log" });
  const empty = element("p", { className: "notification-log-empty", textContent: "No notifications yet." });
  const copy = element("button", { type: "button", className: "small notification-log-copy", textContent: "Copy" });
  copy.title = "The whole log, as text, for a bug report";
  const clear = element("button", { type: "button", className: "small notification-log-clear", textContent: "Clear" });
  const head = element(
    "div",
    { className: "notification-log-head" },
    element("p", {
      className: "pref-help",
      textContent:
        "Everything EarBee has told you, and every problem behind the scenes (⚠), newest first, kept between runs. Copy puts it all on the clipboard, for a bug report.",
    }),
    element("div", { className: "notification-log-buttons" }, copy, clear),
  );
  const panel = element("section", { className: "settings-panel", id }, head, empty, list);

  // Drawn only while it's on screen, at most once a frame: the log takes
  // every warning, and redrawing 500 rows for each while Settings is
  // closed would be in playback's way. Off screen it's drawn when it shows
  // again. A detail opened stays open.
  let stale = true;
  let frame = 0;
  function render() {
    frame = 0;
    stale = false;
    const opened = new Set(
      [...list.querySelectorAll(".notification-log-entry:has(details[open])")].map(
        (item) => /** @type {HTMLElement} */ (item).dataset.key,
      ),
    );
    const entries = notificationLog();
    list.replaceChildren(...[...entries].reverse().map(row));
    for (const details of list.querySelectorAll("details")) {
      if (opened.has(/** @type {HTMLElement} */ (details.closest("li")).dataset.key)) details.open = true;
    }
    empty.hidden = entries.length > 0;
    copy.disabled = clear.disabled = entries.length === 0;
  }
  function changed() {
    if (!panel.checkVisibility()) stale = true;
    else frame ||= requestAnimationFrame(render);
  }
  new IntersectionObserver(([seen]) => seen.isIntersecting && stale && render()).observe(panel);

  let copiedTimer = 0;
  onClick(copy, async () => {
    const text = formatLog(notificationLog(), await header());
    const bridge = /** @type {any} */ (window).earbee;
    // The main process's clipboard (it doesn't need the window focused);
    // the browser's outside Electron.
    if (bridge?.copyText) await bridge.copyText(text);
    else await navigator.clipboard.writeText(text);
    copy.textContent = "Copied";
    clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => (copy.textContent = "Copy"), CONFIG.notifications.copiedMs);
  });
  onClick(clear, () => clearNotificationLog());
  onLogChange(changed);
  return panel;
}
