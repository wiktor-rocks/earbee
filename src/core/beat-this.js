// Around the beat model (Beat This!, CPJKU, MIT; models/beat-this-small.onnx):
// cutting a spectrogram (core/melspec.js) into the windows the model
// takes, joining its answers back up, and picking the beats and downbeats
// out of them. Pure; audio/beat-worker.js runs the model in between.
//
// Ported line for line from the Python original (beat_this/inference.py:
// split_piece, aggregate_prediction; model/postprocessor.py: the
// "minimal" postprocessing), so the results match its; see
// tests/unit/beat-this.test.mjs.

export const FPS = 50; // spectrogram frames (and model outputs) per second
export const CHUNK = 1500; // frames per model window (the model takes exactly this many)
const BORDER = 6; // frames at either end of a window whose answers are dropped
const BANDS = 128;
const NOTHING = -1000; // a logit for "certainly not"

/**
 * Where each window starts (split_piece): the first and last are padded
 * by BORDER, consecutive ones overlap by BORDER, and the last is moved
 * back to end with the piece. A frame index can be negative (padding).
 * @param {number} frames
 * @returns {number[]}
 */
export function windowStarts(frames) {
  const starts = [];
  for (let start = -BORDER; start < frames - BORDER; start += CHUNK - 2 * BORDER) starts.push(start);
  if (frames > CHUNK - 2 * BORDER) starts[starts.length - 1] = frames - (CHUNK - BORDER);
  return starts;
}

/**
 * The model's input for the window at `start`: CHUNK frames of BANDS
 * values, the piece's frames with zeros around them, and `length`, how
 * many of them the original would give the model (less than CHUNK only
 * for a piece shorter than a window; the rest is padding, and its
 * answers are ignored).
 * @param {Float32Array} spect frames × BANDS
 * @param {number} frames
 * @param {number} start
 */
export function windowInput(spect, frames, start) {
  const input = new Float32Array(CHUNK * BANDS);
  const from = Math.max(start, 0);
  const to = Math.min(start + CHUNK, frames);
  const left = Math.max(0, -start);
  const right = Math.max(0, Math.min(BORDER, start + CHUNK - frames));
  input.set(spect.subarray(from * BANDS, to * BANDS), left * BANDS);
  return { input, length: left + (to - from) + right };
}

/**
 * Joins the windows' answers (aggregate_prediction, "keep_first": where
 * windows overlap, the earlier one's answer is kept), without their
 * borders. Frames no window answered for stay NOTHING.
 * @param {{ start: number, length: number, beat: Float32Array, downbeat: Float32Array }[]} windows
 * @param {number} frames
 */
export function joinWindows(windows, frames) {
  const beat = new Float32Array(frames).fill(NOTHING);
  const downbeat = new Float32Array(frames).fill(NOTHING);
  for (let w = windows.length - 1; w >= 0; w--) {
    if (!windows[w]) continue; // not run yet
    const { start, length, beat: b, downbeat: d } = windows[w];
    for (let i = BORDER; i < length - BORDER; i++) {
      const frame = start + i;
      if (frame < 0 || frame >= frames) continue;
      beat[frame] = b[i];
      downbeat[frame] = d[i];
    }
  }
  return { beat, downbeat };
}

/**
 * The frames that are the highest within 3 frames either side and above
 * 0 (a probability over 0.5), with runs of neighbouring ones replaced by
 * their mean (deduplicate_peaks, width 1).
 * @param {Float32Array} logits
 * @returns {number[]} Frame positions, fractional where merged.
 */
export function pickPeaks(logits) {
  const peaks = [];
  for (let i = 0; i < logits.length; i++) {
    if (!(logits[i] > 0)) continue;
    let highest = -Infinity;
    for (let k = Math.max(0, i - 3); k <= Math.min(logits.length - 1, i + 3); k++)
      highest = Math.max(highest, logits[k]);
    if (logits[i] === highest) peaks.push(i);
  }
  const merged = [];
  if (!peaks.length) return merged;
  let mean = peaks[0];
  let count = 1;
  for (let p = 1; p < peaks.length; p++) {
    if (peaks[p] - mean <= 1) {
      count++;
      mean += (peaks[p] - mean) / count;
    } else {
      merged.push(mean);
      mean = peaks[p];
      count = 1;
    }
  }
  merged.push(mean);
  return merged;
}

/**
 * The beats and downbeats in seconds, from the joined logits. Each
 * downbeat is moved onto its nearest beat (two landing on one count once).
 * @param {Float32Array} beatLogits
 * @param {Float32Array} downbeatLogits
 */
export function beatsFromLogits(beatLogits, downbeatLogits) {
  const beats = Float64Array.from(pickPeaks(beatLogits), (frame) => frame / FPS);
  let downbeats = pickPeaks(downbeatLogits).map((frame) => frame / FPS);
  if (beats.length) {
    // The nearest beat, the earlier on a tie (as numpy's argmin): both are in order.
    let b = 0;
    downbeats = downbeats.map((time) => {
      while (b + 1 < beats.length && Math.abs(beats[b + 1] - time) < Math.abs(beats[b] - time)) b++;
      return beats[b];
    });
  }
  return { beats, downbeats: Float64Array.from(new Set(downbeats)).sort() };
}
