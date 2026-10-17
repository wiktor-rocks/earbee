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
import { resetMarks } from "../marks.js";
import { getLoopRegion, getStartPoint, setLoopRegion, setStartPoint } from "../playback.js";

/**
 * @typedef {object} Section
 * @property {string} id
 * @property {string} label
 * @property {number} version
 * @property {boolean} dirties
 * @property {() => object} capture
 * @property {(data: any, track: { duration: number }) => void} restore
 */

const SOUND_SLIDERS = ["speed", "volume", "semitones", "cents"];
const finite = (value) => Number.isFinite(value);
const timeIn = (value, duration) => (finite(value) ? clamp(value, 0, duration) : null);

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
    }),
    restore(data) {
      // setSetting keeps each value inside its slider's range.
      for (const key of SOUND_SLIDERS) if (finite(data[key])) setSetting(key, data[key]);
      for (const band of CONFIG.eq.bands) if (finite(data.eq?.[band.id])) setSetting(band.id, data.eq[band.id]);
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
      if (finite(data.stepSize)) setStepSize(data.stepSize);
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
];
