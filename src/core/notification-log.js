// The notification log's entries (ui/toast.js keeps them, Settings ›
// Notifications shows them): what to keep and how to read it back. Pure,
// so the unit tests can check it without a page.

/** @typedef {"done" | "notice" | "error"} NoticeKind */
/** @typedef {{ time: number, kind: NoticeKind, text: string, detail?: string }} LogEntry */

const KINDS = new Set(["done", "notice", "error"]);

/**
 * The log with `entry` added at the end, trimmed to the newest `max`.
 * @param {LogEntry[]} log
 * @param {LogEntry} entry
 * @param {number} max
 * @returns {LogEntry[]}
 */
export function appendEntry(log, entry, max) {
  const next = [...log, entry];
  return next.length > max ? next.slice(next.length - max) : next;
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
      (entry.detail === undefined || typeof entry.detail === "string"),
  );
  return entries.slice(Math.max(0, entries.length - max));
}
