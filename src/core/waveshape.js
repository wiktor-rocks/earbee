// Shaping the waveform: from the decoded levels (peak and RMS per slice,
// core/peaks.js) to heights in 0…1 that look alike from song to song, and
// the values of each column the drawing (waveform-draw.js) shows. Pure.
//
// The scale is set by a high percentile of the track's level, not its
// single loudest sample, so one click doesn't shrink a quiet song to a
// line; the loudest slices above it are clipped to the full height. What
// is drawn is never outside 0…1, so it never spills out of the card.

/** @typedef {import("./parts.js").Levels} Levels */
/**
 * The Settings › Waveform values (prefs/sections/waveform.js).
 * @typedef {object} Appearance
 * @property {"bars" | "continuous" | "twoTone"} style
 * @property {"loudness" | "peaks"} measure  what bars and continuous show
 * @property {"linear" | "log"} scale
 * @property {"combined" | "split"} stereo
 * @property {number} height  percent
 */
/** @typedef {{ top: Levels, bottom: Levels }} Shaped Heights to draw, per half. */

// The reference level fills this much of each half, leaving a little room
// for what is louder.
const HEADROOM = 0.9;
// The logarithmic scale shows this many dB below the reference.
const RANGE_DB = 48;
// The reference's histogram: log-spaced bins covering this many nepers
// (≈ 104 dB) below the loudest value. Anything quieter counts as silence.
const BINS = 2048;
const SPAN = 12;
// The loudness is a sliding RMS over about this long (see slicesPerWindow).
const WINDOW_SECONDS = 0.02;

// The minimap's overview: the song's quietest sound (OVERVIEW_FLOOR of the
// height) to its loudest (the full height), stretched in dB, so its loud
// and quiet parts stand out to find your way. A range under
// OVERVIEW_MIN_DB is widened, so a steady sound isn't blown up from its
// own wobbles. Below OVERVIEW_SILENCE_DB under the loudest is silence (0).
const OVERVIEW_FLOOR = 0.12;
const OVERVIEW_MIN_DB = 3;
const OVERVIEW_SILENCE_DB = 80;
// Its loudness is smoothed over this many loudness windows (≈ 60 ms).
const OVERVIEW_SMOOTHING = 3;

/**
 * The level that `quantile` of the non-silent values stay under. A
 * histogram over the log of the values, so one pass, and fine enough
 * (0.6 % per bin) at any loudness. Values at or below `floor` are left out.
 * @param {ArrayLike<number>} values
 * @param {number} [quantile]
 * @param {number} [floor]
 */
export function referenceLevel(values, quantile = 0.995, floor = 0) {
  let max = 0;
  for (let i = 0; i < values.length; i++) if (values[i] > max) max = values[i];
  if (!(max > floor)) return 0;

  const top = Math.log(max);
  const bottom = top - SPAN;
  const perBin = BINS / SPAN;
  const counts = new Uint32Array(BINS);
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!(value > floor)) continue;
    const at = Math.log(value);
    if (at < bottom) continue;
    counts[Math.min(BINS - 1, Math.floor((at - bottom) * perBin))]++;
    total++;
  }

  const wanted = Math.ceil(quantile * total);
  for (let bin = 0, seen = 0; bin < BINS; bin++) {
    seen += counts[bin];
    if (seen >= wanted) return Math.exp(bottom + (bin + 1) / perBin);
  }
  return max;
}

/** Slices per loudness window (shapeLevels) for `count` slices of a track of `duration` seconds. */
export const slicesPerWindow = (count, duration) => Math.max(1, Math.round((count / duration) * WINDOW_SECONDS));

/**
 * The heights to draw, in 0…1 of each half (top: up from the middle,
 * bottom: down), for both the peak and the RMS.
 *
 * The loudness is a sliding RMS over `window` slices (see slicesPerWindow).
 * A short track has only a few samples per slice, whose own "RMS" swings
 * with the wave itself; unsmoothed, its loudness would be drawn lower than
 * a long track's. In two-tone the loudness core is kept inside the peak
 * outline.
 * @param {Levels[]} levels  one per channel
 * @param {Appearance} appearance
 * @param {{ window?: number }} [options]
 * @returns {Shaped}
 */
export function shapeLevels(levels, { style, measure, scale, stereo, height }, { window = 1 } = {}) {
  const channels = levels.slice(0, 2).map((channel) => ({ peak: channel.peak, rms: slidingRms(channel.rms, window) }));
  const both = { peak: louderOf(channels, "peak"), rms: louderOf(channels, "rms") };

  // Two-tone draws both against the peak's reference, so the loudness core
  // fits inside the peak outline.
  const twoTone = style === "twoTone";
  const reference = referenceLevel(twoTone || measure === "peaks" ? both.peak : both.rms);
  const gain = (HEADROOM * height) / 100;

  const shape = (series) => {
    const out = new Float32Array(series.length);
    if (!(reference > 0)) return out;
    for (let i = 0; i < series.length; i++) {
      const relative = series[i] / reference;
      let y = relative;
      if (scale === "log") y = relative > 0 ? 1 + (20 * Math.log10(relative)) / RANGE_DB : 0;
      y *= gain;
      out[i] = y > 1 ? 1 : y > 0 ? y : 0;
    }
    return out;
  };
  const shapeChannel = (channel) => {
    const peak = shape(channel.peak);
    const rms = shape(channel.rms);
    if (twoTone) for (let i = 0; i < rms.length; i++) if (rms[i] > peak[i]) rms[i] = peak[i];
    return { peak, rms };
  };

  if (stereo === "split") {
    const top = shapeChannel(channels[0]);
    return { top, bottom: channels.length > 1 ? shapeChannel(channels[1]) : top };
  }
  const shaped = shapeChannel(both);
  return { top: shaped, bottom: shaped };
}

/**
 * The minimap's heights, in 0…1 (both halves the same, `peak` = `rms`, so
 * it draws like shapeLevels' result): the loudness of both channels,
 * stretched between the song's quiet and loud levels (see the top).
 * @param {Levels[]} levels  one per channel
 * @param {{ window?: number }} [options]  as for shapeLevels
 * @returns {Shaped}
 */
export function shapeOverview(levels, { window = 1 } = {}) {
  const loudness = slidingRms(louderOf(levels.slice(0, 2), "rms"), Math.max(1, window * OVERVIEW_SMOOTHING));
  const out = new Float32Array(loudness.length);
  const loud = referenceLevel(loudness);
  if (loud > 0) {
    const silence = loud * 10 ** (-OVERVIEW_SILENCE_DB / 20);
    const quiet = Math.min(referenceLevel(loudness, 0.01, silence), loud * 10 ** (-OVERVIEW_MIN_DB / 20));
    const span = Math.log(loud / quiet);
    for (let i = 0; i < out.length; i++) {
      const v = loudness[i];
      if (!(v > silence)) continue;
      const stretched = Math.min(1, Math.max(0, Math.log(v / quiet) / span));
      out[i] = OVERVIEW_FLOOR + (1 - OVERVIEW_FLOOR) * stretched;
    }
  }
  const side = { peak: out, rms: out };
  return { top: side, bottom: side };
}

/**
 * The value of each of `columns` columns showing `count` values of
 * `series` from `start` (see rangeLevel for `combine`). Zoomed in past one
 * value per column, a column shows the value it falls on, so there are no
 * gaps.
 * @param {ArrayLike<number>} series
 * @param {number} start
 * @param {number} count
 * @param {number} columns
 * @param {"max" | "rms"} [combine]
 */
export function columnLevels(series, start, count, columns, combine = "max") {
  const out = new Float32Array(Math.max(0, columns));
  const last = Math.min(series.length, start + count) - 1;
  if (last < start) return out;
  for (let c = 0; c < out.length; c++) {
    const from = start + Math.floor((c * count) / columns);
    const to = Math.min(last + 1, start + Math.floor(((c + 1) * count) / columns));
    out[c] = to <= from ? series[Math.min(from, last)] : rangeLevel(series, from, to, combine);
  }
  return out;
}

/**
 * The values `from` (inclusive) to `to` (exclusive, past `from`) as one:
 * the largest, or their RMS ("rms", for loudness: one loud slice then
 * doesn't fill a whole column or bar).
 * @param {ArrayLike<number>} series
 * @param {number} from
 * @param {number} to
 * @param {"max" | "rms"} [combine]
 */
export function rangeLevel(series, from, to, combine = "max") {
  let value = 0;
  if (combine === "rms") {
    for (let i = from; i < to; i++) value += series[i] * series[i];
    return Math.sqrt(value / (to - from));
  }
  for (let i = from; i < to; i++) if (series[i] > value) value = series[i];
  return value;
}

/** How a series of `kind` ("peak" or "rms") combines: loudness as RMS, peaks as the largest. */
export const combineFor = (kind) => (kind === "rms" ? "rms" : "max");

// The louder of the first two channels' `key`, value by value (one
// channel: its own).
function louderOf(channels, key) {
  const a = channels[0][key];
  const b = channels[1]?.[key] ?? a;
  if (a === b) return a;
  const out = new Float32Array(Math.min(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = a[i] > b[i] ? a[i] : b[i];
  return out;
}

// A sliding RMS over `window` values (centred), via running sums: O(n).
function slidingRms(series, window) {
  if (window <= 1) return series;
  const sums = new Float64Array(series.length + 1);
  for (let i = 0; i < series.length; i++) sums[i + 1] = sums[i] + series[i] * series[i];
  const out = new Float32Array(series.length);
  const before = Math.floor(window / 2);
  for (let i = 0; i < series.length; i++) {
    const from = Math.max(0, i - before);
    const to = Math.min(series.length, from + window);
    out[i] = Math.sqrt((sums[to] - sums[from]) / (to - from));
  }
  return out;
}
