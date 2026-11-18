// The From YouTube dialog's search history (features/download.js): the
// words searched and where, newest first. Pure, so the unit tests can
// check it without a page.

/** @typedef {{ text: string, source: string, time: number }} PastSearch */

// The same search: the same words (spaces and case aside) on the same site.
const key = (/** @type {PastSearch} */ search) =>
  `${search.source}\n${search.text.trim().replace(/\s+/g, " ").toLowerCase()}`;

/**
 * The history with `search` first, an older copy of it gone, trimmed to
 * the newest `max`.
 * @param {PastSearch[]} history
 * @param {PastSearch} search
 * @param {number} max
 * @returns {PastSearch[]}
 */
export function addSearch(history, search, max) {
  const entry = { ...search, text: search.text.trim() };
  return [entry, ...history.filter((each) => key(each) !== key(entry))].slice(0, max);
}

/**
 * The history without its `index`th entry.
 * @param {PastSearch[]} history
 * @param {number} index
 * @returns {PastSearch[]}
 */
export const removeSearch = (history, index) => history.filter((_, each) => each !== index);

/**
 * The history stored as JSON, read back. Anything unreadable gives an
 * empty history; a bad entry, or one for a site that's no longer offered,
 * is left out.
 * @param {string | null} text
 * @param {number} max
 * @param {string[]} sourceIds
 * @returns {PastSearch[]}
 */
export function parseHistory(text, max, sourceIds) {
  let data;
  try {
    data = JSON.parse(text ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (entry) =>
        entry &&
        typeof entry.text === "string" &&
        entry.text.trim() !== "" &&
        sourceIds.includes(entry.source) &&
        Number.isFinite(entry.time),
    )
    .slice(0, max);
}
