// What a project file (.ebee) saves: one section per part of a session.
// THE place to change it. To save something new, add a section here:
//
//   id        its key in the file's "sections"; never change it
//   label     what a notice calls it ("the marks")
//   version   its saved form's version: bump it when the form changes, and
//             teach restore() to read the older ones (it gets data.version)
//   dirties   whether changing it counts as an unsaved change (the cursor
//             and the zoom are saved, but moving them doesn't ask to save)
//   capture() its saved form now: plain JSON, without `version` (added here)
//   dirtyKey()  (optional) something smaller than capture() that changes
//             whenever it does, for checking for unsaved changes (which
//             happens after every click)
//   restore(data, track)
//             brings it back after the project's media has loaded (so it
//             starts from a new file's defaults). `data` comes from a file,
//             so anything in it may be missing or wrong: check and clamp.
//             Throwing skips this section with a notice; the rest still load.
//
// A section missing from a file keeps the defaults; one the app doesn't
// know (from a newer version) is ignored, and kept out of the next save.
import { CONFIG } from "../../config.js";
import { eqGains, marks, player, settings } from "../../context.js";
import { clamp } from "../../core/format.js";
import { MARKS_VERSION } from "../../marks/index.js";
import { setEqEnabled, setSetting, setStepSize } from "../../ui/controls.js";
import { restoreBeats, savedBeats } from "../beats.js";
import { resetMarks } from "../marks.js";
import { getLoopRegion, getStartPoint, setLoopRegion, setStartPoint } from "../playback.js";
import { getTimelineShare, setTimelineShare } from "../stage-split.js"; // Stage split (src/features/stage-split.js)

/**
 * @typedef {object} Section
 * @property {string} id
 * @property {string} label
 * @property {number} version
 * @property {boolean} dirties
 * @property {() => object} capture
 * @property {() => any} [dirtyKey]
 * @property {(data: any, track: { duration: number }) => void} restore
 */

const SOUND_SLIDERS = ["speed", "volume", "semitones", "cents"];
const finite = (value) => Number.isFinite(value);
const timeIn = (value, duration) => (finite(value) ? clamp(value, 0, duration) : null);
// Times to the millisecond, enough for a beat, and a much shorter file.
const toMs = (times) => Array.from(times, (time) => Math.round(time * 1000) / 1000);

/**
 * Beat edits read back from a file: each one checked, or its default.
 * @returns {import("../../core/beat-edits.js").BeatEdits}
 */
function beatEditsFrom(data) {
  const defaults = CONFIG.beats.edits;
  const max = CONFIG.beats.maxBarShift;
  return {
    bars: typeof data?.bars === "boolean" ? data.bars : defaults.bars,
    steady: typeof data?.steady === "boolean" ? data.steady : defaults.steady,
    tempo: [0.5, 1, 2].includes(data?.tempo) ? data.tempo : defaults.tempo,
    subdivide: [1, 2, 3, 4].includes(data?.subdivide) ? data.subdivide : defaults.subdivide,
    barShift: Number.isInteger(data?.barShift) ? clamp(data.barShift, -max, max) : defaults.barShift,
  };
}

/** @type {Section[]} */
export const SECTIONS = [
  {
    id: "sound",
    label: "the speed, pitch, volume and EQ",
    version: 1,
    dirties: true,
    capture: () => ({
      ...Object.fromEntries(SOUND_SLIDERS.map((key) => [key, settings[key]])),
      eqEnabled: settings.eqEnabled,
      eq: eqGains(),
      focus: { low: settings.eqFocusLow, high: settings.eqFocusHigh },
    }),
    restore(data) {
      // setSetting keeps each value inside its slider's range.
      for (const key of SOUND_SLIDERS) if (finite(data[key])) setSetting(key, data[key]);
      for (const band of CONFIG.eq.bands) if (finite(data.eq?.[band.id])) setSetting(band.id, data.eq[band.id]);
      // The Focus (none in projects saved before it: it stays off). The
      // high end first, so the low one can't push it.
      if (finite(data.focus?.high)) setSetting("eqFocusHigh", data.focus.high);
      if (finite(data.focus?.low)) setSetting("eqFocusLow", data.focus.low);
      if (typeof data.eqEnabled === "boolean") setEqEnabled(data.eqEnabled);
    },
  },
  {
    id: "marks",
    label: "the marks",
    version: MARKS_VERSION,
    dirties: true,
    // Already versioned (src/marks/index.js), which also checks them on the way back.
    capture: () => marks.toJSON(),
    restore: (data, { duration }) => resetMarks(duration, data),
  },
  {
    id: "loop",
    label: "the loop",
    version: 1,
    dirties: true,
    capture: () => ({ region: getLoopRegion() }),
    restore(data, { duration }) {
      const region = data.region;
      if (!region) return setLoopRegion(null);
      const [start, end] = [timeIn(region.start, duration), timeIn(region.end, duration)];
      // Too short, or not times at all: no loop (setLoopRegion checks the length).
      if (start === null || end === null) return setLoopRegion(null);
      setLoopRegion({ start: Math.min(start, end), end: Math.max(start, end), enabled: region.enabled !== false });
    },
  },
  {
    // What the finder found, once all of it is (not the edited beats: the
    // edits are saved apart, so they can still be undone after reopening).
    // Before "playback", whose step size may be "1 beat" or "1 bar".
    id: "beats",
    label: "the beats",
    version: 1,
    dirties: true,
    capture() {
      const saved = savedBeats();
      if (!saved) return { found: null };
      const { raw, method, edits } = saved;
      return { found: { method, times: toMs(raw.times), bars: raw.bars && toMs(raw.bars) }, edits };
    },
    dirtyKey() {
      const saved = savedBeats();
      return saved && { revision: saved.revision, edits: saved.edits };
    },
    restore(data, { duration }) {
      const found = data.found;
      if (!found) return;
      const times = Array.isArray(found.times) ? found.times.filter((time) => finite(time) && time >= 0) : [];
      const inTrack = times.filter((time) => time <= duration);
      if (inTrack.length < 2 || inTrack.some((time, i) => i > 0 && time <= inTrack[i - 1]))
        throw new Error("the beat times aren't a list of times in order");
      // A bar start is one of the beats (core/beat-this.js).
      const onBeats = new Set(inTrack);
      const bars = Array.isArray(found.bars) ? found.bars.filter((time) => onBeats.has(time)) : [];
      restoreBeats({
        times: Float64Array.from(inTrack),
        bars: bars.length > 1 ? Float64Array.from(bars) : null,
        method: found.method === "simple" ? "simple" : "model",
        edits: beatEditsFrom(data.edits),
      });
    },
  },
  {
    id: "playback",
    label: "where you were",
    version: 1,
    dirties: false,
    capture: () => ({
      position: player.transport.position,
      startPoint: getStartPoint(),
      stepSize: settings.stepSize,
    }),
    restore(data, { duration }) {
      // "beat" and "bar" only take with the beats back (setStepSize checks).
      if (finite(data.stepSize) || data.stepSize === "beat" || data.stepSize === "bar") setStepSize(data.stepSize);
      const position = timeIn(data.position, duration);
      // Seeking moves the start point too, so it comes second.
      if (position !== null) player.transport.seek(position);
      const startPoint = timeIn(data.startPoint, duration);
      if (startPoint !== null) setStartPoint(startPoint);
    },
  },
  {
    id: "view",
    label: "the zoom",
    version: 1,
    dirties: false,
    capture: () => player.waveform.getView() ?? {},
    restore: (data) => player.waveform.setView({ seconds: data.seconds ?? null, start: data.start ?? 0 }),
  },
  // Stage split (src/features/stage-split.js): how much of the stage the
  // timeline takes beside a video. Like the zoom, saved, but dragging it
  // isn't an unsaved change.
  {
    id: "stage",
    label: "the video's size",
    version: 1,
    dirties: false,
    capture: () => ({ timelineShare: getTimelineShare() }),
    restore(data) {
      if (finite(data.timelineShare)) setTimelineShare(data.timelineShare);
    },
  },
];
