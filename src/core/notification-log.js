// The notification log's entries (ui/toast.js keeps them, Settings ›
// Notifications shows them): what to keep, how to read it back, and the
// text Copy puts on the clipboard for a bug report. Pure, so the unit
// tests can check it without a page.
//
// Kinds: "done", "notice" and "error" are the cards you see (ui/toast.js);
// "warning" is a problem behind the scenes, logged but never shown as a
// card (a console warning, the main process's or a worker's, an
// unexpected error the page caught by itself; ui/problems.js).

/** @typedef {"done" | "notice" | "error" | "warning"} LogKind */
/** @typedef {"done" | "notice" | "error"} NoticeKind */
/**
 * @typedef {{ time: number, kind: LogKind, text: string, detail?: string, repeat?: number }} LogEntry
 * `repeat`: the same entry this many times in a row (the time is the last).
 */

const KINDS = new Set(["done", "notice", "error", "warning"]);

const same = (a, b) => a.kind === b.kind && a.text === b.text && a.detail === b.detail;

/**
 * The log with `entry` added in time order (the main process's come later
 * than they happened, with their own time), trimmed to the newest `max`.
 * The same entry as the last one only counts again (`repeat`), so a
 * problem that keeps happening doesn't push out everything else.
 * @param {LogEntry[]} log
 * @param {LogEntry} entry
 * @param {number} max
 * @returns {LogEntry[]}
 */
export function appendEntry(log, entry, max) {
  const last = log[log.length - 1];
  if (last && same(last, entry)) {
    const merged = { ...last, time: Math.max(last.time, entry.time), repeat: (last.repeat ?? 1) + 1 };
    return [...log.slice(0, -1), merged];
  }
  let at = log.length;
  while (at > 0 && log[at - 1].time > entry.time) at--;
  const next = [...log.slice(0, at), entry, ...log.slice(at)];
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * The log as it's stored: JSON, at most `maxChars` long (the browser's
 * storage is small, and a full log of stacks could fill it, after which
 * nothing new would be kept). Too long, the oldest entries' details go
 * first, then the oldest entries.
 * @param {readonly LogEntry[]} log
 * @param {number} maxChars
 * @returns {string}
 */
export function storedLog(log, maxChars) {
  const sizes = log.map((entry) => JSON.stringify(entry).length + 1);
  let total = sizes.reduce((sum, size) => sum + size, 2);
  if (total <= maxChars) return JSON.stringify(log);
  const kept = [...log];
  for (let i = 0; i < kept.length && total > maxChars; i++) {
    if (!kept[i].detail) continue;
    const rest = { ...kept[i] };
    delete rest.detail;
    kept[i] = rest;
    const size = JSON.stringify(rest).length + 1;
    total -= sizes[i] - size;
    sizes[i] = size;
  }
  let from = 0;
  while (from < kept.length && total > maxChars) total -= sizes[from++];
  return JSON.stringify(kept.slice(from));
}

/**
 * The log stored as JSON, read back. Anything unreadable (missing, from an
 * older or broken copy) gives an empty log, or loses only the bad entries.
 * @param {string | null} text
 * @param {number} max
 * @returns {LogEntry[]}
 */
export function parseLog(text, max) {
  let data;
  try {
    data = JSON.parse(text ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const entries = data.filter(
    (entry) =>
      entry &&
      Number.isFinite(entry.time) &&
      KINDS.has(entry.kind) &&
      typeof entry.text === "string" &&
      (entry.detail === undefined || typeof entry.detail === "string") &&
      (entry.repeat === undefined || Number.isInteger(entry.repeat)),
  );
  return entries.slice(Math.max(0, entries.length - max));
}

/**
 * Anything (an Error above all) as text for the log: an Error's stack (or
 * its name and message), then each `cause` it carries; other values as
 * JSON where they can be, else as String gives them.
 * @param {unknown} value
 * @returns {string}
 */
export function describe(value) {
  const lines = [];
  let current = value;
  for (let depth = 0; depth < 4 && current !== undefined; depth++) {
    if (depth > 0) lines.push("Caused by:");
    lines.push(describeOne(current));
    current = isErrorLike(current) ? /** @type {any} */ (current).cause : undefined;
  }
  return lines.join("\n");
}

/** @param {unknown} value @returns {value is { message: string, stack?: string, name?: string }} */
const isErrorLike = (value) =>
  value instanceof Error ||
  (typeof value === "object" &&
    value !== null &&
    typeof (/** @type {any} */ (value).message) === "string" &&
    "stack" in value);

/** @param {unknown} value */
function describeOne(value) {
  if (isErrorLike(value)) {
    const head = `${value.name || "Error"}: ${value.message}`;
    // Chromium's stack starts with the name and message; others don't.
    const stack = typeof value.stack === "string" ? value.stack : "";
    return stack.includes(value.message) ? stack : [head, stack].filter(Boolean).join("\n");
  }
  if (typeof value === "string") return value;
  try {
    // Samples and other big arrays by their size, not their contents.
    const text = JSON.stringify(value, (_key, item) =>
      ArrayBuffer.isView(item) || item instanceof ArrayBuffer
        ? `${item.constructor.name}(${/** @type {any} */ (item).length ?? item.byteLength})`
        : Array.isArray(item) && item.length > 50
          ? `Array(${item.length})`
          : item,
    );
    return text ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * What a console.warn or console.error call says, as a log entry's text
 * and detail: the text is its first argument (an Error's message), the
 * detail the rest, and an Error's stack.
 * @param {unknown[]} args
 * @returns {{ text: string, detail?: string }}
 */
export function consoleEntry(args) {
  const [first, ...rest] = args;
  const text = isErrorLike(first) ? first.message || first.name || "Error" : describeOne(first);
  const details = (isErrorLike(first) ? [first, ...rest] : rest).map(describe).filter(Boolean);
  return details.length ? { text, detail: details.join("\n") } : { text };
}

/** "2026-11-27 14:05:12", in local time. @param {number} time */
export function stamp(time) {
  const d = new Date(time);
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/**
 * The log as plain text, for a bug report: `header` (the app, its version
 * and the system), then every entry, oldest first, one line each (time,
 * kind, text, ×N when repeated), its detail indented beneath.
 * @param {readonly LogEntry[]} entries Oldest first.
 * @param {string[]} header
 * @returns {string}
 */
export function formatLog(entries, header) {
  const lines = [...header, ""];
  for (const entry of entries) {
    const repeat = entry.repeat > 1 ? ` (×${entry.repeat})` : "";
    lines.push(`${stamp(entry.time)}  ${entry.kind.padEnd(7)}  ${entry.text}${repeat}`);
    if (entry.detail) for (const line of entry.detail.split("\n")) lines.push(`    ${line}`);
  }
  return lines.join("\n") + "\n";
}
