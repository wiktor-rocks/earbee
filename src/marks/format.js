// What a mark is, and its saved form. Pure (no DOM), so the main process
// can use it too, e.g. to check the marks in a TranscriBee file it reads.
//
// The saved form is versioned: { version: 1, marks: [mark, …] }. A newer
// version is refused rather than misread; when the format changes, bump
// MARKS_VERSION and teach parseMarks() to read the older versions.
import { DEFAULT_MARK_COLOR, MARK_COLORS } from "../themes/index.js";

/**
 * A point (`end` is null) or a region (`end` > `start`), in seconds of the track.
 * @typedef {object} Mark
 * @property {string} id
 * @property {number} start
 * @property {number | null} end
 * @property {string} label
 * @property {string} color A MARK_COLORS id.
 */

/**
 * What a track's marks are checked against.
 * @typedef {object} MarkLimits
 * @property {number} duration The track's length; times are kept inside it.
 * @property {number} minSeconds The shortest region.
 */

export const MARKS_VERSION = 1;
export const MAX_LABEL_LENGTH = 200;

export class MarksFormatError extends Error {}

const ID = /^[\w-]{1,40}$/;
const COLORS = new Set(MARK_COLORS.map((color) => color.id));

const clampTime = (time, duration) => Math.min(Math.max(time, 0), duration > 0 ? duration : Infinity);

/**
 * A complete, valid mark from `raw`, or null if it can't be one. Times are
 * kept inside the track, the ends of a region put in order, and a region
 * that ends up too short becomes a point at its start; an unknown colour
 * becomes the default.
 * @param {any} raw
 * @param {MarkLimits} limits
 * @returns {Mark | null}
 */
export function normalizeMark(raw, { duration, minSeconds }) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !ID.test(raw.id)) return null;
  if (!Number.isFinite(raw.start) || (raw.end !== null && raw.end !== undefined && !Number.isFinite(raw.end)))
    return null;
  let start = clampTime(raw.start, duration);
  let end = raw.end == null ? null : clampTime(raw.end, duration);
  if (end !== null) {
    [start, end] = [Math.min(start, end), Math.max(start, end)];
    if (end - start < minSeconds) end = null;
  }
  return Object.freeze({
    id: raw.id,
    start,
    end,
    label: typeof raw.label === "string" ? raw.label.trim().slice(0, MAX_LABEL_LENGTH) : "",
    color: COLORS.has(raw.color) ? raw.color : DEFAULT_MARK_COLOR,
  });
}

/** @param {Mark} mark */
export const isRegion = (mark) => mark.end !== null;

/** By start, then a point before the regions starting there, then by end. */
export const sortMarks = (/** @type {Mark[]} */ marks) =>
  [...marks].sort((a, b) => a.start - b.start || (a.end ?? -1) - (b.end ?? -1));

/**
 * The saved form of `marks`.
 * @param {Mark[]} marks
 */
export const serializeMarks = (marks) => ({
  version: MARKS_VERSION,
  marks: marks.map(({ id, start, end, label, color }) => ({ id, start, end, label, color })),
});

/**
 * The marks in a saved form, checked against the track: entries that can't
 * be marks are left out, and an id used twice is kept only once.
 * @param {any} data
 * @param {MarkLimits} limits
 * @returns {Mark[]}
 */
export function parseMarks(data, limits) {
  if (!data || typeof data !== "object" || !Number.isInteger(data.version) || !Array.isArray(data.marks))
    throw new MarksFormatError("These aren't marks TranscriBee can read.");
  if (data.version > MARKS_VERSION)
    throw new MarksFormatError("These marks were saved by a newer TranscriBee; update it to open them.");
  const seen = new Set();
  const marks = [];
  for (const raw of data.marks) {
    const mark = normalizeMark(raw, limits);
    if (!mark || seen.has(mark.id)) continue;
    seen.add(mark.id);
    marks.push(mark);
  }
  return sortMarks(marks);
}
