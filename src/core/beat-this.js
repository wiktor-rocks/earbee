// Around the beat model (Beat This!, CPJKU, MIT; models/beat-this-small.onnx):
// cutting a spectrogram (core/melspec.js) into the windows the model
// takes, joining its answers back up, and picking the beats and downbeats
// out of them. Pure; audio/beat-worker.js runs the model in between.
//
// Ported line for line from the Python original (beat_this/inference.py:
// split_piece, aggregate_prediction; model/postprocessor.py: the
// "minimal" postprocessing), so the results match its; see
// tests/unit/beat-this.test.mjs.
import { createLogMelSpectrogram, HOP, MEL_BANDS, MEL_RATE, N_FFT } from "./melspec.js";
import { createResampler, resampleRatio } from "./resample.js";

export const FPS = 50; // spectrogram frames (and model outputs) per second
export const CHUNK = 1500; // frames per model window (the model takes exactly this many)
const BORDER = 6; // frames at either end of a window whose answers are dropped
const BANDS = 128;
const NOTHING = -1000; // a logit for "certainly not"

/**
 * How many spectrogram frames a whole track of `samples` samples at
 * `sampleRate` has (core/melspec.js after core/resample.js), known before
 * any of it is decoded: one every 441 samples at 22,050 Hz, and none for
 * half a window or less.
 * @param {number} samples
 * @param {number} sampleRate
 */
export function framesFor(samples, sampleRate) {
  const { up, down } = resampleRatio(sampleRate, MEL_RATE);
  const resampled = Math.ceil((samples * up) / down);
  return resampled > N_FFT / 2 ? Math.floor(resampled / HOP) + 1 : 0;
}

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
 * The frames of the piece the window at `start` covers: [from, to).
 * @param {number} start
 * @param {number} frames
 */
export const windowFrames = (start, frames) => ({ from: Math.max(start, 0), to: Math.min(start + CHUNK, frames) });

/**
 * What to decode for the window at `start` alone, so that its frames come
 * out exactly as the whole track's (audio/beat-worker.js):
 *   from, to    its frames, [from, to)
 *   firstFrame  where its spectrogram starts (createLogMelSpectrogram's
 *               option): `from`, or 0 for a window at the track's start
 *   atEnd       whether it reaches the track's end (reflected there)
 *   outFrom, outTo  the 22,050 Hz samples those frames are made from
 *               [outFrom, outTo); outTo is Infinity at the end
 *   inFrom, inTo    the input samples to resample for them, [inFrom, inTo):
 *               from `reach` before (aligned to `down`, see resampleRatio),
 *               so the resampler has warmed up by outFrom; inTo Infinity
 *               at the end
 *   outStart    the 22,050 Hz sample the resampler's output starts with
 * @param {number} start
 * @param {number} frames the track's (framesFor)
 * @param {number} sampleRate the track's
 */
export function windowSource(start, frames, sampleRate) {
  const { from, to } = windowFrames(start, frames);
  const { up, down, reach } = resampleRatio(sampleRate, MEL_RATE);
  const firstFrame = from * HOP >= N_FFT / 2 ? from : 0;
  const atEnd = to >= frames;
  const outFrom = firstFrame ? firstFrame * HOP - N_FFT / 2 : 0;
  const outTo = atEnd ? Infinity : (to - 1) * HOP + N_FFT / 2;
  // An output sample is made from the inputs reach − 1 before its position
  // to reach after (and is that one input when the rates are equal).
  const earliest = Math.floor((outFrom * down) / up) - Math.max(0, reach - 1);
  const inFrom = Math.max(0, Math.floor(earliest / down) * down);
  const inTo = atEnd ? Infinity : Math.floor(((outTo - 1) * down) / up) + reach + 1;
  return { from, to, firstFrame, atEnd, outFrom, outTo, inFrom, inTo, outStart: (inFrom * up) / down };
}

/**
 * The spectrogram of one window alone, from the track's mono samples
 * [inFrom, inTo) of `source` (windowSource), pushed in order; more past
 * inTo is fine. finish() gives its frames [from, to), the same as the
 * whole track's (frames × BANDS; fewer at the end if the track turned out
 * shorter than its duration said).
 * @param {ReturnType<typeof windowSource>} source
 * @param {number} sampleRate the track's
 */
export function createWindowSpectrogram(source, sampleRate) {
  const resampler = createResampler(sampleRate, MEL_RATE);
  const spectrogram = createLogMelSpectrogram({ firstFrame: source.firstFrame });
  let at = source.outStart; // the 22,050 Hz sample the resampler's next output is
  // Only [outFrom, outTo) goes on: before, the resampler is warming up;
  // after, it's past the window.
  function feed(samples) {
    const from = Math.max(0, source.outFrom - at);
    const to = Math.min(samples.length, source.outTo - at);
    at += samples.length;
    if (to > from) spectrogram.push(samples.subarray(from, to));
  }
  return {
    /** @param {Float32Array} samples The next mono samples. */
    push(samples) {
      resampler.push(samples);
      feed(resampler.take());
    },
    finish() {
      // Past the end the whole track's resampler assumed silence; elsewhere
      // every output needed has been made already.
      if (source.atEnd) resampler.finish();
      feed(resampler.take());
      const { data } = spectrogram.finish({ atEnd: source.atEnd });
      const skip = source.from - source.firstFrame; // a window at the start began at frame 0
      return data.slice(skip * MEL_BANDS, (source.to - source.firstFrame) * MEL_BANDS);
    },
  };
}

/**
 * The model's input for the window at `start`: CHUNK frames of BANDS
 * values, the piece's frames with zeros around them, and `length`, how
 * many of them the original would give the model (less than CHUNK only
 * for a piece shorter than a window; the rest is padding, and its
 * answers are ignored).
 * @param {Float32Array} spect frames × BANDS, from frame `offset` of the piece
 * @param {number} frames the piece's
 * @param {number} start
 * @param {number} [offset] the piece's frame that `spect` starts with (0: all of it)
 */
export function windowInput(spect, frames, start, offset = 0) {
  const input = new Float32Array(CHUNK * BANDS);
  const { from, to } = windowFrames(start, frames);
  const left = Math.max(0, -start);
  const right = Math.max(0, Math.min(BORDER, start + CHUNK - frames));
  input.set(spect.subarray((from - offset) * BANDS, (to - offset) * BANDS), left * BANDS);
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
