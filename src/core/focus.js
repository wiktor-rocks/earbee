// The EQ's Focus (CONFIG.eq.focus): a range of notes to keep, as the
// frequencies of the filters that cut the rest. Pure functions.

const LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * A note as written in CONFIG ("B0", "F#3", "Bb2", "B♭2") → its MIDI number.
 * @param {string} name
 */
export function noteNumber(name) {
  const match = /^([A-G])([#♯b♭]?)(-?\d)$/.exec(name);
  if (!match) throw new Error(`Not a note: ${name}`);
  const [, letter, accidental, octave] = match;
  const shift = accidental === "#" || accidental === "♯" ? 1 : accidental ? -1 : 0;
  return (Number(octave) + 1) * 12 + LETTERS[letter] + shift;
}

// Equal temperament, A4 = 440 Hz.
export const noteFrequency = (note) => 440 * 2 ** ((note - 69) / 12);

/**
 * The cutoffs (Hz) that keep `low`…`high`, moved by the pitch shift so the
 * same notes of the original are kept. An end at its range's limit cuts
 * nothing: null.
 * @param {{ low: number, high: number, range: { min: number, max: number }, semitones?: number }} focus
 * @returns {{ highpass: number | null, lowpass: number | null }}
 */
export function focusCutoffs({ low, high, range, semitones = 0 }) {
  const shift = 2 ** (semitones / 12);
  return {
    highpass: low > range.min ? noteFrequency(low) * shift : null,
    lowpass: high < range.max ? noteFrequency(high) * shift : null,
  };
}

/**
 * The Q of each two-pole stage of a Butterworth filter of 2 × `stages`
 * poles: together they are flat up to the cutoff and 3 dB down at it
 * (identical stages of Q 0.707 would be 3 dB down each, so 12 dB for 4).
 * @param {number} stages
 */
export function butterworthQs(stages) {
  const poles = 2 * stages;
  return Array.from({ length: stages }, (_, k) => 1 / (2 * Math.cos(((2 * k + 1) * Math.PI) / (2 * poles))));
}

/**
 * The preset whose range is exactly `low`…`high`, or null (a custom range,
 * or none).
 * @template {{ low: string, high: string }} P
 * @param {number} low
 * @param {number} high
 * @param {P[]} presets
 */
export const focusPresetFor = (low, high, presets) =>
  presets.find((preset) => noteNumber(preset.low) === low && noteNumber(preset.high) === high) ?? null;
