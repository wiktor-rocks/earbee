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
  stepSize: CONFIG.step.initial, // seconds, one of CONFIG.step.sizes
  // One gain (dB) per EQ band, keyed by band id: eqLow, eqLowMid, …
  ...Object.fromEntries(CONFIG.eq.bands.map((band) => [band.id, CONFIG.eq.gain.initial])),
};

// The open track's marks (points and regions; src/marks). Change them
// through the actions in features/marks.js, which keep the waveform and
// the marks list in step. What a TranscriBee file would save and restore.
export const marks = createMarks({ minSeconds: CONFIG.marks.minSeconds });

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
