// The marks on the open track: points and regions with a label and a
// colour: what a mark is and its saved form, then the store. Pure (no
// DOM): the page keeps one store (context.js), drawn by the timeline's
// marks lane (timeline.js) and listed by features/marks.js.
//
// Project files save them (features/project/sections.js, the "marks"
// section): toJSON() gives what to save, reset() with the saved form
// brings them back, and "change" (once per edit) marks unsaved changes.
import { createEmitter } from "../core/emitter.js";
import { clamp } from "../core/format.js";
import { DEFAULT_MARK_COLOR, MARK_COLORS } from "../themes/index.js";

/* ---------- What a mark is, and its saved form ---------- */

// The saved form is versioned: { version: 1, marks: [mark, …] }. A newer
// version is refused rather than misread; when the format changes, bump
// MARKS_VERSION and teach parseMarks() to read the older versions.

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

const clampTime = (time, duration) => clamp(time, 0, duration > 0 ? duration : Infinity);

/**
 * A complete, valid mark from `raw`, or null if it can't be one. Times are
 * kept inside the track, the ends of a region put in order, and a region
 * that ends up too short becomes a point at its start; an unknown colour
 * becomes the default.
 * @param {any} raw
 * @param {MarkLimits} limits
 * @returns {Mark | null}
 */
function normalizeMark(raw, { duration, minSeconds }) {
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
const isRegion = (mark) => mark.end !== null;

/** By start, then a point before the regions starting there, then by end. */
const sortMarks = (/** @type {Mark[]} */ marks) =>
  [...marks].sort((a, b) => a.start - b.start || (a.end ?? -1) - (b.end ?? -1));

/**
 * The saved form of `marks`.
 * @param {Mark[]} marks
 */
const serializeMarks = (marks) => ({
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
    throw new MarksFormatError("These aren't marks ScriBee can read.");
  if (data.version > MARKS_VERSION)
    throw new MarksFormatError("These marks were saved by a newer ScriBee; update it to open them.");
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

/* ---------- The store ---------- */

const DEFAULT_LABELS = { point: "Mark", region: "Region" };
// "Previous" and "next" skip a mark this close to the time (rounding).
const SAME_TIME = 1e-3;

/**
 * @param {object} [options]
 * @param {number} [options.minSeconds] The shortest region.
 */
export function createMarks({ minSeconds = 0.05 } = {}) {
  const events = createEmitter();
  let duration = 0;
  /** @type {Mark[]} */
  let marks = []; // sorted (sortMarks)
  let lastId = 0;

  const limits = () => ({ duration, minSeconds });

  function commit(next) {
    marks = sortMarks(next);
    events.emit("change", list());
  }

  const list = () => [...marks];
  const get = (/** @type {string} */ id) => marks.find((mark) => mark.id === id) ?? null;

  // "Mark 3" if the highest numbered "Mark n" is 2 (and "Mark 1" once there are none).
  function nextLabel(shape) {
    const prefix = DEFAULT_LABELS[shape];
    const numbers = marks.map((mark) => new RegExp(`^${prefix} (\\d+)$`).exec(mark.label)).filter(Boolean);
    return `${prefix} ${Math.max(0, ...numbers.map((match) => Number(match[1]))) + 1}`;
  }

  /** @param {{ start: number, end: number | null, label?: string, color?: string }} fields */
  function add(fields) {
    const shape = fields.end === null ? "point" : "region";
    const mark = normalizeMark({ label: nextLabel(shape), ...fields, id: `m${lastId + 1}` }, limits());
    if (!mark || isRegion(mark) !== (shape === "region")) return null; // a region too short
    lastId++;
    commit([...marks, mark]);
    return mark;
  }

  return {
    /**
     * A new track: no marks, or the ones saved with it (the form toJSON() gives).
     * @param {number} trackDuration
     * @param {unknown} [saved]
     */
    reset(trackDuration, saved) {
      duration = trackDuration;
      const restored = saved === undefined ? [] : parseMarks(saved, limits());
      lastId = Math.max(0, ...restored.map((mark) => Number(/^m(\d+)$/.exec(mark.id)?.[1] ?? 0)));
      commit(restored);
    },

    list,
    get,

    /** @param {number} time @param {{ label?: string, color?: string }} [fields] */
    addPoint: (time, fields = {}) => add({ ...fields, start: time, end: null }),

    /**
     * A region between two times, in either order; null if it's too short.
     * @param {number} start @param {number} end @param {{ label?: string, color?: string }} [fields]
     */
    addRegion: (start, end, fields = {}) => add({ ...fields, start, end }),

    /**
     * Changes a mark's times, label or colour. Returns the changed mark, or
     * null if there's no such mark or it would make a region too short.
     * @param {string} id
     * @param {Partial<Omit<Mark, "id">>} changes
     */
    update(id, changes) {
      const old = get(id);
      if (!old) return null;
      const mark = normalizeMark({ ...old, ...changes, id }, limits());
      const wantsRegion = (changes.end === undefined ? old.end : changes.end) !== null;
      if (!mark || isRegion(mark) !== wantsRegion) return null;
      if (Object.keys(mark).every((key) => mark[key] === old[key])) return old;
      commit(marks.map((other) => (other.id === id ? mark : other)));
      return mark;
    },

    /** @param {string} id */
    remove(id) {
      if (!get(id)) return false;
      commit(marks.filter((mark) => mark.id !== id));
      return true;
    },

    /**
     * The last mark starting before `time`, skipping those that start less
     * than `tolerance` seconds before it (so pressing "previous" again while
     * playing keeps going back).
     * @param {number} time @param {number} [tolerance]
     */
    previous: (time, tolerance = 0) =>
      marks.findLast((mark) => mark.start < time - Math.max(tolerance, SAME_TIME)) ?? null,

    /** The first mark starting after `time`. @param {number} time */
    next: (time) => marks.find((mark) => mark.start > time + SAME_TIME) ?? null,

    /** The saved form (see serializeMarks above). */
    toJSON: () => serializeMarks(marks),

    /** "change", with the new list, after every edit and reset. */
    on: events.on,
  };
}

/** @typedef {ReturnType<typeof createMarks>} Marks */
