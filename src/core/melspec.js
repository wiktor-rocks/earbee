// The beat model's input (core/beat-this.js): a log-mel spectrogram of the
// sound at 22,050 Hz, 50 frames a second, 128 bands. Pure.
//
// It must match the Python original's exactly (beat_this LogMelSpect, on
// torchaudio's MelSpectrogram), or the model hears something it wasn't
// trained on and does worse without any error: a 1024-point STFT every
// 441 samples, periodic Hann window, centred frames with the signal
// reflected at both ends, magnitudes divided by √1024, a slaney-scale mel
// filterbank (30 Hz to 11 kHz, triangles not area-normalized), then
// log(1 + 1000 · x). tests/unit/beat-this.test.mjs checks it against the
// original's output.
import { createSpectrum } from "./fft.js";

export const MEL_RATE = 22050;
export const MEL_BANDS = 128;
export const N_FFT = 1024;
export const HOP = 441;
const BINS = N_FFT / 2 + 1;
const F_MIN = 30;
const F_MAX = 11000;
const LOG_MULTIPLIER = 1000;

// The slaney mel scale: linear below 1 kHz, logarithmic above.
const F_SP = 200 / 3;
const MIN_LOG_MEL = 1000 / F_SP;
const LOG_STEP = Math.log(6.4) / 27;
const hzToMel = (hz) => (hz >= 1000 ? MIN_LOG_MEL + Math.log(hz / 1000) / LOG_STEP : hz / F_SP);
const melToHz = (mel) => (mel >= MIN_LOG_MEL ? 1000 * Math.exp(LOG_STEP * (mel - MIN_LOG_MEL)) : F_SP * mel);

/**
 * The mel filterbank as torchaudio's melscale_fbanks makes it: weights
 * [bin · MEL_BANDS + band] for the BINS frequencies 0…11,025 Hz.
 * @returns {Float64Array}
 */
export function melFilterbank() {
  const lowest = hzToMel(F_MIN);
  const highest = hzToMel(F_MAX);
  // The triangles' corners: MEL_BANDS + 2 points evenly spaced in mels.
  const corners = Array.from({ length: MEL_BANDS + 2 }, (_, i) =>
    melToHz(lowest + ((highest - lowest) * i) / (MEL_BANDS + 1)),
  );
  const weights = new Float64Array(BINS * MEL_BANDS);
  for (let bin = 0; bin < BINS; bin++) {
    const hz = (bin * Math.floor(MEL_RATE / 2)) / (BINS - 1);
    for (let band = 0; band < MEL_BANDS; band++) {
      const down = (hz - corners[band]) / (corners[band + 1] - corners[band]);
      const up = (corners[band + 2] - hz) / (corners[band + 2] - corners[band + 1]);
      weights[bin * MEL_BANDS + band] = Math.max(0, Math.min(down, up));
    }
  }
  return weights;
}

/**
 * A streaming log-mel spectrogram of mono samples at MEL_RATE. Frame k is
 * centred on sample k · 441 (at k / 50 s).
 *
 * By default it makes a whole track's frames: the samples from its start,
 * with the signal reflected at the start (and at the end, by finish()).
 * With `firstFrame` (2 or more), it makes those of a part of a track: the
 * samples start at sample firstFrame · 441 − 512, where that frame's
 * window begins, and frame `firstFrame` comes out first, the same as the
 * whole track's (audio/beat-worker.js prepares the model's windows so).
 * @param {{ firstFrame?: number }} [options]
 */
export function createLogMelSpectrogram({ firstFrame = 0 } = {}) {
  if (firstFrame !== 0 && !(firstFrame * HOP >= N_FFT / 2)) {
    throw new RangeError(`a part starts at frame 0, or at 2 or later (not ${firstFrame})`);
  }
  // Each band's weights as a run of bins, skipping the zeros.
  const bank = melFilterbank();
  const bands = Array.from({ length: MEL_BANDS }, (_, band) => {
    let first = BINS;
    let last = -1;
    for (let bin = 0; bin < BINS; bin++) {
      if (bank[bin * MEL_BANDS + band] > 0) [first, last] = [Math.min(first, bin), bin];
    }
    const weights = last < first ? new Float64Array(0) : new Float64Array(last - first + 1);
    for (let bin = first; bin <= last; bin++) weights[bin - first] = bank[bin * MEL_BANDS + band];
    return { first, weights };
  });
  const window = Float64Array.from({ length: N_FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT));
  const spectrum = createSpectrum(N_FFT, BINS);
  const windowed = new Float64Array(N_FFT);
  const magnitudes = new Float64Array(BINS);
  const scale = 1 / Math.sqrt(N_FFT);

  let frames = new Float32Array(MEL_BANDS * 1024);
  let count = 0;
  // The padded signal not yet used up. Until half a window has come in,
  // the start can't be reflected yet, so the samples wait in `head`. A
  // part of a track isn't reflected: its samples go straight in.
  let head = firstFrame ? null : [];
  let headLength = 0;
  let buffer = firstFrame ? new Float32Array(1 << 16) : null;
  let filled = 0;
  // The last N_FFT / 2 + 1 samples, to reflect the end.
  const tail = new Float32Array(N_FFT / 2 + 1);

  function frame(at) {
    for (let i = 0; i < N_FFT; i++) windowed[i] = buffer[at + i] * window[i];
    spectrum(windowed, magnitudes);
    if ((count + 1) * MEL_BANDS > frames.length) {
      const grown = new Float32Array(frames.length * 2);
      grown.set(frames);
      frames = grown;
    }
    const out = count * MEL_BANDS;
    for (let band = 0; band < MEL_BANDS; band++) {
      const { first, weights } = bands[band];
      let sum = 0;
      for (let k = 0; k < weights.length; k++) sum += weights[k] * magnitudes[first + k];
      frames[out + band] = Math.log1p(LOG_MULTIPLIER * sum * scale);
    }
    count++;
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
    for (; filled - at >= N_FFT; at += HOP) frame(at);
    buffer.copyWithin(0, at, filled);
    filled -= at;
  }

  function keepTail(samples) {
    const n = samples.length;
    if (n >= tail.length) tail.set(samples.subarray(n - tail.length));
    else {
      tail.copyWithin(0, n);
      tail.set(samples, tail.length - n);
    }
  }

  // Once half a window has come in: the reflected start, then all of it.
  function start() {
    const first = new Float32Array(headLength);
    let at = 0;
    for (const chunk of head) {
      first.set(chunk, at);
      at += chunk.length;
    }
    head = null;
    buffer = new Float32Array(Math.max(1 << 16, 2 * (headLength + N_FFT)));
    const reflected = new Float32Array(N_FFT / 2);
    for (let i = 0; i < N_FFT / 2; i++) reflected[i] = first[N_FFT / 2 - i];
    append(reflected);
    append(first);
  }

  return {
    /** @param {Float32Array} samples The next mono samples, at MEL_RATE. */
    push(samples) {
      if (!samples.length) return;
      keepTail(samples);
      if (head) {
        head.push(Float32Array.from(samples));
        headLength += samples.length;
        if (headLength > N_FFT / 2) start();
      } else append(samples);
    },
    /**
     * The spectrogram: `frames` rows of MEL_BANDS values in `data`, from
     * `firstFrame` on. Empty if the sound was too short to reflect (half a
     * window or less). `atEnd` false: the samples stop before the track's
     * end, so it isn't reflected there; the frames are those whose window
     * was all there.
     * @param {{ atEnd?: boolean }} [options]
     */
    finish({ atEnd = true } = {}) {
      if (head) return { frames: 0, data: new Float32Array(0) };
      if (atEnd) {
        // The reflected end: the samples before the last, backwards.
        const reflected = new Float32Array(N_FFT / 2);
        for (let i = 0; i < N_FFT / 2; i++) reflected[i] = tail[tail.length - 2 - i];
        append(reflected);
      }
      return { frames: count, data: frames.slice(0, count * MEL_BANDS) };
    },
  };
}
