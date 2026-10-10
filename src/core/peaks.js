// Waveform peaks from decoded samples. Pure functions.
import { clamp } from "./format.js";

// Reduce samples to two values per `factor` samples: the largest
// magnitude (the peak, so transients survive in the drawing) and the RMS
// (the loudness, which tells beats from gaps even in a loud mastered song,
// where nearly every block peaks near full scale). Both are ≥ 0.
// Runs over every sample of a song, so the inner loop is kept minimal.
// Always new arrays (the worker transfers them), even for a factor of 1.
/** @returns {{ peak: Float32Array, rms: Float32Array }} */
export function downsampleLevels(samples, factor) {
  const step = Math.max(1, factor);
  const length = samples.length;
  const count = Math.ceil(length / step);
  const peak = new Float32Array(count);
  const rms = new Float32Array(count);

  for (let start = 0, out = 0; start < length; start += step, out++) {
    const end = Math.min(start + step, length);
    let max = 0;
    let squares = 0;

    for (let i = start; i < end; i++) {
      const sample = samples[i];
      squares += sample * sample;
      if (sample > max) max = sample;
      else if (-sample > max) max = -sample;
    }

    peak[out] = max;
    rms[out] = Math.sqrt(squares / (end - start));
  }

  return { peak, rms };
}

// Peaks per second needed to draw a track of `duration` seconds at 2 peaks
// per device pixel at maximum zoom, in a window at most `widestPx` wide.
// `limits` is CONFIG.waveform.
export function peaksPerSecondFor(duration, widestPx, { maxZoomMultiplier, minPeaksPerSecond, maxPeaksPerSecond }) {
  const needed = (widestPx / duration) * maxZoomMultiplier * 2;
  return clamp(Math.ceil(needed), minPeaksPerSecond, maxPeaksPerSecond);
}
