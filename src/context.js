// State shared by the UI and the features: the user's settings, the open
// track's marks, and the player's components. app.js creates the
// components and puts them in `player` before anything else runs.
import { CONFIG } from "./config.js";
import { createMarks } from "./marks/index.js";

// The single copy of every user setting. Change values through setSetting()
// (ui/controls.js) so the UI and the audio follow.
export const settings = {
  speed: CONFIG.speed.initial,
  volume: CONFIG.volume.initial, // percent
  semitones: CONFIG.semitones.initial,
  cents: CONFIG.cents.initial,
  eqEnabled: CONFIG.eq.enabledInitially,
  // Seconds, one of CONFIG.step.sizes, or "beat" / "bar" (to the next
  // beat or downbeat) while the track's beats (and downbeats) are known.
  stepSize: /** @type {number | "beat" | "bar"} */ (CONFIG.step.initial),
  // One gain (dB) per EQ band, keyed by band id: eqLow, eqLowMid, …
  ...Object.fromEntries(CONFIG.eq.bands.map((band) => [band.id, CONFIG.eq.gain.initial])),
};

// The open track's marks (points and regions; src/marks). Change them
// through the actions in features/marks.js, which keep the waveform and
// the marks list in step. Project files save and restore them.
export const marks = createMarks({ minSeconds: CONFIG.marks.minSeconds });

// The open track's beats (features/beats.js). `status`: "idle" (not looked
// for yet), "finding" (`progress` 0…1), "found", or "none" (no steady
// beat). Once found: `times` in seconds, in order; `bpm`; `downbeat`, one
// flag per beat for the first of each bar, and `bars`, their times, with
// `barLength` (null without downbeats: the simple finder has none);
// `method`, which finder found them; `complete`, false while the beat
// model is still filling in the rest of the track (`progress` goes on).
// `shown`: whether their lines are drawn. A new file starts idle.
// All of these are the beats as edited: `raw` is what the finder found
// (beats and bar starts), which a project saves, and `edits` the
// project's edits to it (core/beat-edits.js: steady grid, half or double
// time, bar starts moved, `subdivisions` between the beats).
export const beats = {
  status: /** @type {"idle" | "finding" | "found" | "none"} */ ("idle"),
  progress: 0,
  times: /** @type {Float64Array | null} */ (null),
  bpm: /** @type {number | null} */ (null),
  downbeat: /** @type {Uint8Array | null} */ (null),
  bars: /** @type {Float64Array | null} */ (null),
  barLength: /** @type {number | null} */ (null),
  subdivisions: /** @type {Float64Array | null} */ (null),
  raw: /** @type {{ times: Float64Array, bars: Float64Array | null } | null} */ (null),
  edits: /** @type {import("./core/beat-edits.js").BeatEdits} */ ({ ...CONFIG.beats.edits }),
  method: /** @type {"model" | "simple" | null} */ (null),
  complete: false,
  shown: true,
};
// The average beat and bar in seconds, or null without them.
export const beatLength = () => (beats.status === "found" ? 60 / beats.bpm : null);
export const barLength = () => (beats.status === "found" ? beats.barLength : null);

export const totalSemitones = () => settings.semitones + settings.cents / 100;
export const eqGains = () => Object.fromEntries(CONFIG.eq.bands.map((band) => [band.id, settings[band.id]]));

/**
 * @typedef {object} Player
 * @property {import("./audio/engine.js").AudioEngine} engine
 * @property {import("./audio/transport.js").Transport} transport
 * @property {import("./waveform.js").Waveform} waveform
 * @property {import("./timeline.js").Timeline} timeline The lanes above the waveform (markers).
 * @property {import("./video/view.js").VideoView} videoView
 */

/** The components, filled in by app.js at startup. */
export const player = /** @type {Player} */ ({});

export const hasAudio = () => player.transport.duration > 0;
