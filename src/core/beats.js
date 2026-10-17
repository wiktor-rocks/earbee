// Finding the beats of a track, and stepping by them. Pure, so it's
// unit-tested; audio/beat-worker.js feeds it the decoded sound.
//
// 1. The onset envelope (createOnsetDetector): how much the sound gets
//    louder, frame by frame (every ~11.6 ms), summed over the spectrum
//    up to 8 kHz ("spectral flux" of the log magnitude). It peaks on note
//    attacks and drum hits. Streamed: the samples are pushed in chunks,
//    so the whole track is never held at once.
// 2. The tempo (estimateTempo): the envelope's autocorrelation over the
//    beat lengths of 40–240 BPM, weighted towards 120 BPM so a song isn't
//    read at double or half its tempo.
// 3. The beats (trackBeats): dynamic programming (Ellis 2007, as in
//    librosa's beat_track): each frame's best score is its onset strength
//    plus the best earlier beat's, minus a penalty for a gap that isn't
//    the tempo's beat length. Following the best path back gives beats
//    that fit the onsets and drift with the tempo (live music).

import { createSpectrum } from "./fft.js";

/* ---------- 1. The onset envelope ---------- */

const HOP_SECONDS = 0.0116;
const WINDOW_SECONDS = 0.023; // rounded to the nearest power of two in samples
const MAX_HZ = 8000;
// log(1 + COMPRESSION · magnitude): quiet detail counts, loud doesn't swamp.
const COMPRESSION = 1000;
// The envelope minus its moving mean over this long, clipped at 0: what's
// left are the attacks, not the general loudness.
const MEAN_SECONDS = 0.5;

/**
 * A streaming onset detector for mono sound at `sampleRate`. Frame k is
 * centred on sample k · hop, so it is at k / frameRate seconds.
 * @param {number} sampleRate
 */
export function createOnsetDetector(sampleRate) {
  const hop = Math.max(1, Math.round(sampleRate * HOP_SECONDS));
  const size = 2 ** Math.max(4, Math.round(Math.log2(sampleRate * WINDOW_SECONDS)));
  const bins = Math.max(1, Math.min(size / 2, Math.floor((MAX_HZ * size) / sampleRate)));
  const window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const scale = COMPRESSION / (size / 2); // a full-scale sine's peak bin ≈ COMPRESSION / 2
  const spectrum = createSpectrum(size, bins);
  const windowed = new Float64Array(size);
  const magnitudes = new Float64Array(bins);
  let previous = new Float64Array(bins);
  let current = new Float64Array(bins);

  // The samples not yet used up; it starts with half a window of silence,
  // which centres the frames.
  let buffer = new Float32Array(Math.max(size * 4, 1 << 16));
  let filled = size / 2;
  let flux = [];

  function frame(at) {
    for (let i = 0; i < size; i++) windowed[i] = buffer[at + i] * window[i];
    spectrum(windowed, magnitudes);
    let sum = 0;
    for (let k = 0; k < bins; k++) {
      const level = Math.log1p(magnitudes[k] * scale);
      current[k] = level;
      if (level > previous[k]) sum += level - previous[k];
    }
    [previous, current] = [current, previous];
    flux.push(sum / bins);
  }

  function append(samples) {
    if (filled + samples.length > buffer.length) {
      const grown = new Float32Array(Math.max(buffer.length * 2, filled + samples.length));
      grown.set(buffer.subarray(0, filled));
      buffer = grown;
    }
    buffer.set(samples, filled);
    filled += samples.length;
    let at = 0;
    for (; filled - at >= size; at += hop) frame(at);
    buffer.copyWithin(0, at, filled);
    filled -= at;
  }

  return {
    hop,
    size,
    frameRate: sampleRate / hop,
    /** @param {Float32Array} samples The next mono samples. */
    push(samples) {
      append(samples);
    },
    /** The envelope, once every sample has been pushed. */
    finish() {
      append(new Float32Array(size / 2)); // the last frames, centred too
      const envelope = removeMovingMean(Float32Array.from(flux), Math.round((MEAN_SECONDS * sampleRate) / hop));
      flux = [];
      return { envelope, frameRate: sampleRate / hop };
    },
  };
}

// `values` minus their mean over `width` frames around each, clipped at 0.
function removeMovingMean(values, width) {
  const half = Math.max(1, Math.floor(width / 2));
  const sums = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++) sums[i + 1] = sums[i] + values[i];
  const result = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const from = Math.max(0, i - half);
    const to = Math.min(values.length, i + half + 1);
    result[i] = Math.max(0, values[i] - (sums[to] - sums[from]) / (to - from));
  }
  return result;
}

/* ---------- 2. The tempo ---------- */

const MIN_BPM = 40;
const MAX_BPM = 240;
const PRIOR_BPM = 120;
const PRIOR_OCTAVES = 1; // the weighting's spread (standard deviation)
// How clear the pulse must be: the weighted autocorrelation at the beat
// length as a share of the envelope's energy. Click tracks score about
// 0.9, music 0.2–0.6, white noise 0.05, a steady tone almost 0.
const MIN_CLARITY = 0.1;

/**
 * The beat length in frames (fractional), or null if there is no clear pulse.
 * @param {Float32Array} envelope
 * @param {number} frameRate
 * @returns {number | null}
 */
export function estimateTempo(envelope, frameRate) {
  const n = envelope.length;
  const minLag = Math.max(1, Math.floor((frameRate * 60) / MAX_BPM));
  const maxLag = Math.min(n - 1, Math.ceil((frameRate * 60) / MIN_BPM));
  if (maxLag <= minLag + 1) return null;

  let mean = 0;
  for (const value of envelope) mean += value;
  mean /= n;
  const centred = Float64Array.from(envelope, (value) => value - mean);
  let energy = 0;
  for (const value of centred) energy += value * value;

  const weighted = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    if (lag < 1 || lag >= n) continue;
    let sum = 0;
    for (let i = lag; i < n; i++) sum += centred[i] * centred[i - lag];
    const octaves = Math.log2((frameRate * 60) / lag / PRIOR_BPM) / PRIOR_OCTAVES;
    weighted[lag] = sum * Math.exp(-0.5 * octaves * octaves);
  }

  let best = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) if (weighted[lag] > weighted[best]) best = lag;
  if (!(weighted[best] > MIN_CLARITY * energy)) return null;
  // Between frames: the top of the parabola through the peak and its neighbours.
  const [a, b, c] = [weighted[best - 1], weighted[best], weighted[best + 1]];
  const curve = a - 2 * b + c;
  const shift = curve < 0 ? (0.5 * (a - c)) / curve : 0;
  return best + Math.max(-0.5, Math.min(0.5, shift));
}

/* ---------- 3. The beats ---------- */

// How strictly the gap between beats keeps to the beat length.
const TIGHTNESS = 100;

/**
 * The beats, in seconds, for a beat length of `period` frames.
 * @param {Float32Array} envelope
 * @param {number} frameRate
 * @param {number} period
 * @returns {Float64Array}
 */
export function trackBeats(envelope, frameRate, period) {
  const n = envelope.length;
  const deviation = standardDeviation(envelope);
  if (!(deviation > 0) || n < 2 * period) return new Float64Array(0);

  // The onset strength, smoothed by a Gaussian about a 16th of a beat wide.
  const reach = Math.round(period);
  const kernel = Float64Array.from({ length: 2 * reach + 1 }, (_, i) =>
    Math.exp(-0.5 * (((i - reach) * 32) / period) ** 2),
  );
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -reach; k <= reach; k++) {
      const j = i + k;
      if (j >= 0 && j < n) sum += kernel[k + reach] * envelope[j];
    }
    local[i] = sum / deviation;
  }

  // The previous beat is half a beat to two beats back.
  const nearest = Math.max(1, Math.round(period / 2));
  const farthest = Math.round(2 * period);
  const penalty = new Float64Array(farthest + 1);
  for (let gap = nearest; gap <= farthest; gap++) penalty[gap] = -TIGHTNESS * Math.log(gap / period) ** 2;

  const score = new Float64Array(n);
  const backlink = new Int32Array(n).fill(-1);
  let threshold = 0;
  for (const value of local) threshold = Math.max(threshold, value);
  threshold *= 0.01;
  let started = false; // nothing links back until the first real onset
  for (let i = 0; i < n; i++) {
    let best = -Infinity;
    let from = -1;
    for (let gap = nearest; gap <= farthest && gap <= i; gap++) {
      const candidate = score[i - gap] + penalty[gap];
      if (candidate > best) [best, from] = [candidate, i - gap];
    }
    score[i] = local[i] + (from >= 0 ? best : 0);
    if (started || local[i] >= threshold) {
      backlink[i] = from;
      started = true;
    }
  }

  // The last beat: the latest peak of the score at least half the median peak.
  const peaks = [];
  for (let i = 1; i < n - 1; i++) if (score[i] > score[i - 1] && score[i] >= score[i + 1]) peaks.push(i);
  if (!peaks.length) return new Float64Array(0);
  const median = [...peaks.map((i) => score[i])].sort((x, y) => x - y)[Math.floor(peaks.length / 2)];
  let last = peaks.at(-1);
  for (let p = peaks.length - 1; p >= 0; p--) {
    if (score[peaks[p]] >= 0.5 * median) {
      last = peaks[p];
      break;
    }
  }
  const frames = [];
  for (let i = last; i >= 0; i = backlink[i]) frames.push(i);
  frames.reverse();

  return Float64Array.from(trimWeakEnds(frames, local), (i) => i / frameRate);
}

// Leaves out the beats at either end that land on (almost) nothing: the
// tracker keeps the pulse going through silence.
function trimWeakEnds(frames, local) {
  if (frames.length < 3) return frames;
  const strengths = frames.map((i) => local[i]);
  // Smoothed over neighbouring beats (a 5-point Hann window).
  const weights = [0.25, 0.75, 1, 0.75, 0.25];
  const smooth = strengths.map((_, b) => {
    let sum = 0;
    let total = 0;
    for (let k = -2; k <= 2; k++) {
      if (b + k < 0 || b + k >= strengths.length) continue;
      sum += weights[k + 2] * strengths[b + k];
      total += weights[k + 2];
    }
    return sum / total;
  });
  const threshold = 0.5 * Math.sqrt(smooth.reduce((sum, value) => sum + value * value, 0) / smooth.length);
  let first = 0;
  let end = frames.length;
  while (first < end && smooth[first] < threshold) first++;
  while (end > first && smooth[end - 1] < threshold) end--;
  return frames.slice(first, end);
}

function standardDeviation(values) {
  let mean = 0;
  for (const value of values) mean += value;
  mean /= values.length;
  let squares = 0;
  for (const value of values) squares += (value - mean) ** 2;
  return Math.sqrt(squares / Math.max(1, values.length - 1));
}

/**
 * The beats (seconds) and the tempo (beats per minute, from the median
 * gap), or no beats and a null tempo if there is no pulse.
 * @param {Float32Array} envelope
 * @param {number} frameRate
 * @returns {{ beats: Float64Array, bpm: number | null }}
 */
export function detectBeats(envelope, frameRate) {
  const period = estimateTempo(envelope, frameRate);
  const beats = period === null ? new Float64Array(0) : trackBeats(envelope, frameRate, period);
  if (beats.length < 2) return { beats: new Float64Array(0), bpm: null };
  return { beats, bpm: 60 / medianGap(beats) };
}

/* ---------- Using them ---------- */

/**
 * The median gap between consecutive times (in order), or null for fewer than two.
 * @param {ArrayLike<number>} times
 */
export function medianGap(times) {
  if (times.length < 2) return null;
  const gaps = Array.from({ length: times.length - 1 }, (_, i) => times[i + 1] - times[i]).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

// The index of the first beat later than `time` (beats.length if none).
function firstAfter(beats, time) {
  let low = 0;
  let high = beats.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (beats[middle] > time) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * The beats from `start` to `end` (seconds), as the indices [from, to).
 * @param {ArrayLike<number>} beats In order.
 * @param {number} start
 * @param {number} end
 */
export function visibleBeats(beats, start, end) {
  // firstAfter(start − ε) is the first beat at or after `start`.
  return { from: firstAfter(beats, start - 1e-9), to: firstAfter(beats, end) };
}

/**
 * When the beats play, on a clock (seconds), between clock times t0 and
 * t1: `from` and `to` are the track positions then, playing at `rate`. If
 * `to` is before `from`, the A–B `loop` wrapped in between. Each beat in
 * [from, to) counts once, so back-to-back calls never repeat one. Each
 * comes with its `index` in `beats`.
 * @param {ArrayLike<number>} beats In order.
 * @param {{ t0: number, t1: number, from: number, to: number, rate: number, loop?: { start: number, end: number } | null }} span
 * @returns {{ time: number, index: number }[]}
 */
export function beatClockTimes(beats, { t0, t1, from, to, rate, loop = null }) {
  const times = [];
  const add = (start, end, clockOf) => {
    for (let i = firstAfter(beats, start - 1e-9); i < beats.length && beats[i] < end - 1e-9; i++) {
      times.push({ time: clockOf(beats[i]), index: i });
    }
  };
  if (to >= from) add(from, to, (beat) => t0 + (beat - from) / rate);
  else if (loop) {
    add(from, loop.end, (beat) => t0 + (beat - from) / rate);
    add(loop.start, to, (beat) => t1 - (to - beat) / rate);
  }
  return times;
}

// A step lands on the next beat beyond this distance, so a step taken just
// after a beat (while playing, or after the previous step) doesn't land on
// the same one again.
export const BEAT_STEP_EPSILON = 0.03;

/**
 * Where a step by one beat from `position` lands: the next beat (direction
 * 1) or the previous one (−1). Before the first beat or after the last, it
 * steps by `length` (the average beat) instead.
 * @param {ArrayLike<number>} beats In order.
 * @param {number} position
 * @param {1 | -1} direction
 * @param {number} length
 */
export function beatStep(beats, position, direction, length, epsilon = BEAT_STEP_EPSILON) {
  if (direction > 0) {
    const next = firstAfter(beats, position + epsilon);
    return next < beats.length ? beats[next] : position + length;
  }
  // The last beat earlier than position − ε.
  const previous = firstAfter(beats, position - epsilon - 1e-9) - 1;
  return previous >= 0 ? beats[previous] : position - length;
}

/**
 * The step sizes in order of length: `sizes` (seconds) with "beat" and
 * "bar" among them by their lengths (the average beat and bar, in
 * seconds); either is left out when its length is null.
 * @param {readonly number[]} sizes In order.
 * @param {{ beat?: number | null, bar?: number | null }} lengths
 * @returns {(number | "beat" | "bar")[]}
 */
export function stepSizes(sizes, { beat = null, bar = null } = {}) {
  /** @type {[number | "beat" | "bar", number][]} */
  const all = sizes.map((size) => [size, size]);
  if (beat !== null) all.push(["beat", beat]);
  if (bar !== null) all.push(["bar", bar]);
  // A stable sort keeps a seconds size before "beat" or "bar" of the same length.
  return all.sort((a, b) => a[1] - b[1]).map(([size]) => size);
}
