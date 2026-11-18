// Settings › Notifications: every message the app has shown (ui/toast.js
// keeps them, between runs too), newest first, with when it came. A tab of
// its own in the Settings dialog (features/settings.js), though it isn't a
// setting: so a message that went by too fast can be read again, and a
// path in one copied. Clear empties it.
import { element, onClick } from "../ui/dom.js";
import { clearNotificationLog, notificationLog, onLogChange } from "../ui/toast.js";

const KIND_NAMES = { done: "Done", notice: "Notice", error: "Error" };
const MARKS = { done: "✓", notice: "i", error: "!" };

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

/** @param {import("../core/notification-log.js").LogEntry} entry */
function row(entry) {
  const mark = element("span", { className: "toast-mark", textContent: MARKS[entry.kind] });
  mark.title = KIND_NAMES[entry.kind];
  const body = element("div", { className: "notification-log-body" }, element("span", { textContent: entry.text }));
  if (entry.detail) body.append(element("small", { className: "toast-detail", textContent: entry.detail }));
  const time = element("time", { className: "notification-log-time", textContent: when(entry.time) });
  time.dateTime = new Date(entry.time).toISOString();
  return element("li", { className: `notification-log-entry toast-${entry.kind}` }, mark, body, time);
}

/**
 * The tab's panel, kept up to date while the app runs.
 * @param {string} id the panel's id (the tab points at it)
 */
export function buildNotificationLog(id) {
  const list = element("ol", { className: "notification-log" });
  const empty = element("p", { className: "notification-log-empty", textContent: "No notifications yet." });
  const clear = element("button", { type: "button", className: "small", textContent: "Clear" });
  const head = element(
    "div",
    { className: "notification-log-head" },
    element("p", {
      className: "pref-help",
      textContent: "Every message EarBee has shown, newest first, kept between runs.",
    }),
    clear,
  );
  const panel = element("section", { className: "settings-panel", id }, head, empty, list);

  function render() {
    const entries = notificationLog();
    list.replaceChildren(...[...entries].reverse().map(row));
    empty.hidden = entries.length > 0;
    clear.disabled = entries.length === 0;
  }
  onClick(clear, () => clearNotificationLog());
  onLogChange(render);
  render();
  return panel;
}
