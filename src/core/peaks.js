// Waveform peaks from decoded samples. Pure functions.
import { clamp } from "./format.js";

// Reduce samples to one value per `factor` samples, keeping the largest
// excursion (positive or negative) so peaks survive in the drawing.
// Runs over every sample of a song, so the inner loop is kept minimal.
export function downsamplePeaks(samples, factor) {
  if (factor <= 1) return samples;

  const length = samples.length;
  const peaks = new Float32Array(Math.ceil(length / factor));

  for (let start = 0, out = 0; start < length; start += factor, out++) {
    const end = Math.min(start + factor, length);
    let min = 0;
    let max = 0;

    for (let i = start; i < end; i++) {
      const sample = samples[i];
      if (sample > max) max = sample;
      else if (sample < min) min = sample;
    }

    peaks[out] = max >= -min ? max : min;
  }

  return peaks;
}

// Peaks per second needed to draw a track of `duration` seconds at 2 peaks
// per device pixel at maximum zoom, in a window at most `widestPx` wide.
// `limits` is CONFIG.waveform.
export function peaksPerSecondFor(duration, widestPx, { maxZoomMultiplier, minPeaksPerSecond, maxPeaksPerSecond }) {
  const needed = (widestPx / duration) * maxZoomMultiplier * 2;
  return clamp(Math.ceil(needed), minPeaksPerSecond, maxPeaksPerSecond);
}
