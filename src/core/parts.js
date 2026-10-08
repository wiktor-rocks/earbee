// Decoding a track in parts, in parallel (see audio/decoder.js): where the
// parts go, how many there are, and where each one joins the one before.

/**
 * Splits `[0, totalFrames)` into `count` parts of about equal length:
 * [{ from, to }]. Inner boundaries are multiples of `align` (the peak
 * factor), so the parts' peaks put end to end are the whole track's. The
 * last part runs to the end of the stream (`to` Infinity): the length is
 * only an estimate from the duration.
 * @param {number} totalFrames
 * @param {number} count
 * @param {number} align
 * @returns {{ from: number, to: number }[]}
 */
export function splitFrames(totalFrames, count, align) {
  const bounds = [0];
  for (let k = 1; k < count; k++) {
    const bound = Math.round((totalFrames * k) / count / align) * align;
    if (bound > bounds.at(-1) && bound < totalFrames) bounds.push(bound);
  }
  return bounds.map((from, k) => ({ from, to: k + 1 < bounds.length ? bounds[k + 1] : Infinity }));
}

/**
 * How many workers decode a track: one for short tracks, else one per
 * spare core, up to `maxWorkers`.
 * @param {number} duration  seconds
 * @param {number} cores  navigator.hardwareConcurrency
 * @param {{ minDuration: number, maxWorkers: number }} config
 */
export function workerCount(duration, cores, { minDuration, maxWorkers }) {
  if (!(duration >= minDuration)) return 1;
  return Math.max(1, Math.min((cores || 1) - 1, maxWorkers));
}

/**
 * Where, in the part before, the part after starts: the index in `before`
 * whose samples equal `after`'s first `window` samples, searched from
 * `expected` (where the timestamps put it) outwards, up to `maxLag`
 * frames either way; the nearest match wins. Timestamps aren't always
 * sample-exact (WebM's are rounded to the millisecond, and Opus's codec
 * delay isn't applied to them), but once a decoder has warmed up its
 * samples are, so the samples decide.
 *
 * Returns `expected` if `after` starts silent (nothing to match: the
 * timestamps are trusted), and null if nothing matches (the parts can't
 * be joined; decode in one piece instead).
 * @param {Float32Array[]} before  the earlier part, one array per channel
 * @param {Float32Array[]} after  the later part
 * @param {number} expected
 * @param {{ maxLag: number, window: number, tolerance: number }} options
 * @returns {number | null}
 */
export function findJoin(before, after, expected, { maxLag, window, tolerance }) {
  const length = Math.min(window, after[0].length);
  const silent = after.every((samples) => samples.subarray(0, length).every((x) => Math.abs(x) <= tolerance));
  if (silent) return expected;

  const matchesAt = (start) => {
    if (start < 0 || start + length > before[0].length) return false;
    for (let c = 0; c < after.length; c++) {
      const a = after[c];
      const b = before[c];
      for (let i = 0; i < length; i++) if (Math.abs(a[i] - b[start + i]) > tolerance) return false;
    }
    return true;
  };
  for (let lag = 0; lag <= maxLag; lag++) {
    if (matchesAt(expected - lag)) return expected - lag;
    if (lag && matchesAt(expected + lag)) return expected + lag;
  }
  return null;
}

/**
 * Puts decoded parts end to end, without copying the samples: part k keeps
 * its first `keep[k]` frames (where the next part starts). The pieces stay
 * separate (they're played one after the other); the peaks, which are
 * small, are joined per channel.
 * @param {{ channels: Float32Array[], peaks: Float32Array[] }[]} parts
 * @param {number[]} keep  frames kept of each part
 * @param {number} peakFactor  samples per peak
 * @returns {{ pieces: Float32Array[][], peaks: Float32Array[], frames: number }}
 */
export function joinParts(parts, keep, peakFactor) {
  const pieces = parts.map((part, k) => part.channels.map((samples) => samples.subarray(0, keep[k])));
  const peaks = parts[0].peaks.map((_, c) => {
    const kept = parts.map((part, k) => part.peaks[c].subarray(0, Math.ceil(keep[k] / peakFactor)));
    const joined = new Float32Array(kept.reduce((sum, array) => sum + array.length, 0));
    let offset = 0;
    for (const array of kept) {
      joined.set(array, offset);
      offset += array.length;
    }
    return joined;
  });
  return { pieces, peaks, frames: keep.reduce((sum, frames) => sum + frames, 0) };
}
