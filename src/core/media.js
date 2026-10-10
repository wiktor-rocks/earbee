// Media and decoding helpers. Pure, so the decode workers and the unit
// tests use them too:
//   - what a media file is (its name and type, and reading it),
//   - how much memory a decoded track needs, and whether that fits,
//   - waveform levels (peaks and loudness) from decoded samples,
//   - decoding a track in parts, in parallel (see audio/decoder.js): where
//     the parts go, how many there are, and where each one joins the one
//     before.
import { clamp } from "./format.js";

/* ---------- Media files ---------- */

/**
 * Something to open: a File the user chose or dropped, or a file the main
 * process serves by URL (a download; see electron/media-files.js). Either
 * way it's read in pieces, never whole.
 * @typedef {File | { name: string, url: string }} Media
 */

export const fileExtension = (name) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();

// `videoExtensions` is CONFIG.video.extensions.
/** @param {Media} media @param {string[]} videoExtensions */
export const isVideoFile = (media, videoExtensions) =>
  ("type" in media && media.type.startsWith("video/")) || videoExtensions.includes(fileExtension(media.name));

/**
 * A Mediabunny source reading `media`. The classes are passed in (core
 * imports nothing).
 * @param {Media} media
 * @param {{ BlobSource: any, UrlSource: any }} sources
 */
export const mediaSource = (media, { BlobSource, UrlSource }) =>
  media instanceof Blob ? new BlobSource(media) : new UrlSource(media.url);

/**
 * All of `media`'s bytes at once (only for the decoding fallback, on files
 * Mediabunny can't read).
 * @param {Media} media
 */
export const readWhole = async (media) =>
  media instanceof Blob ? media.arrayBuffer() : (await fetch(media.url)).arrayBuffer();

/* ---------- Memory ---------- */

// Bytes of decoded audio: one 32-bit float per sample per channel, which is
// how the time-stretcher needs it.
export const decodedBytes = (duration, sampleRate, channels) => Math.ceil(duration * sampleRate) * channels * 4;

// Leave room for the rest of the app and the system: a track may use at
// most `share` of the free memory. Unknown free memory (null) always fits.
export const fitsInMemory = (bytes, freeBytes, share = 0.8) => freeBytes == null || bytes <= freeBytes * share;

/* ---------- Waveform levels ---------- */

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

/* ---------- Decoding in parts ---------- */

/**
 * Splits `[0, totalFrames)` into `count` parts of about equal length:
 * [{ from, to }]. Inner boundaries are multiples of `align` (the peak
 * factor), so the parts' levels put end to end are the whole track's. The
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
 * separate (they're played one after the other); the waveform levels,
 * which are small, are joined per channel.
 * @param {{ channels: Float32Array[], levels: Levels[] }[]} parts
 * @param {number[]} keep  frames kept of each part
 * @param {number} peakFactor  samples per level
 * @returns {{ pieces: Float32Array[][], levels: Levels[], frames: number }}
 */
export function joinParts(parts, keep, peakFactor) {
  const pieces = parts.map((part, k) => part.channels.map((samples) => samples.subarray(0, keep[k])));
  const join = (c, key) => {
    const kept = parts.map((part, k) => part.levels[c][key].subarray(0, Math.ceil(keep[k] / peakFactor)));
    const joined = new Float32Array(kept.reduce((sum, array) => sum + array.length, 0));
    let offset = 0;
    for (const array of kept) {
      joined.set(array, offset);
      offset += array.length;
    }
    return joined;
  };
  const levels = parts[0].levels.map((_, c) => ({ peak: join(c, "peak"), rms: join(c, "rms") }));
  return { pieces, levels, frames: keep.reduce((sum, frames) => sum + frames, 0) };
}

/** @typedef {{ peak: Float32Array, rms: Float32Array }} Levels One channel's waveform levels (downsampleLevels). */
