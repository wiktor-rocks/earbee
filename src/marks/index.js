// The marks on the open track: points and regions with a label and a
// colour (format.js says what a mark is). Pure (no DOM): the page keeps
// one store (context.js) and draws it (waveform.js, features/marks.js).
//
// For now marks last for the session. A TranscriBee file that saves them
// would plug in at three places: toJSON() gives what to save, reset() with
// the saved form brings them back when its track opens, and "change" (once
// per edit) says when there's something new to save.
import { createEmitter } from "../core/emitter.js";
import { isRegion, normalizeMark, parseMarks, serializeMarks, sortMarks } from "./format.js";

export * from "./format.js";

/** @typedef {import("./format.js").Mark} Mark */

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

    /** The saved form (see format.js). */
    toJSON: () => serializeMarks(marks),

    /** "change", with the new list, after every edit and reset. */
    on: events.on,
  };
}

/** @typedef {ReturnType<typeof createMarks>} Marks */
