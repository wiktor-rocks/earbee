// A project's own edits to the beats found (features/beats.js): what the
// finder gave is kept as it was, and these are worked out from it again
// whenever an edit changes, so every edit can be undone. Pure.
//
// In order (bars may be turned off first: then all beats are alike, as
// the simple finder's, and nothing below has bar starts to keep):
//   1. a steady grid: beats crowded closer than a share of the local beat
//      dropped (the model's stray extras), gaps of a whole number of
//      beats filled, and stray bar starts dropped. The beat model can
//      waver between two tempo levels, keeping a weak in-between beat
//      here and dropping it there; this settles on the one most of the
//      song around it has;
//   2. half time (every other beat, and every other bar, so a bar keeps
//      its number of beats) or double time (a beat between each two);
//   3. the bar starts moved by a number of beats, for a bar line the
//      model put on the wrong beat;
//   4. subdivisions: evenly spaced times between the beats, kept apart
//      from them (drawn fainter, snapped to; never stepped or clicked).

import { medianGap } from "./beats.js";

/**
 * @typedef {object} BeatEdits
 * @property {boolean} bars Bar starts (a strong first beat) kept; false: none, all beats alike.
 * @property {boolean} steady
 * @property {0.5 | 1 | 2} tempo Half time, as found, or double time.
 * @property {1 | 2 | 3 | 4} subdivide Parts per beat (1: none).
 * @property {number} barShift Bar starts moved by this many beats.
 */

/**
 * @typedef {object} SteadyLimits (CONFIG.beats.steady)
 * @property {number} periodBeats The local beat is the median gap over this many beats around.
 * @property {number} dropBelow A beat closer than this share of the local beat to the previous one is a stray.
 * @property {number} fillTolerance A gap fills if it's within this share of a whole number of beats…
 * @property {number} maxFill …of at most this many (a long break stays empty).
 * @property {number} barDropBelow A bar start closer than this share of the median bar to the previous one is a stray.
 */

/** @type {BeatEdits} */
export const NO_EDITS = Object.freeze({ bars: true, steady: false, tempo: 1, subdivide: 1, barShift: 0 });

/**
 * The beats with `edits` applied.
 * @param {{ times: ArrayLike<number>, bars: ArrayLike<number> | null }} raw As found: beats in
 *   order, and the bar starts (each one of the beats), or null without bars.
 * @param {BeatEdits} edits
 * @param {SteadyLimits} limits
 * @returns {{ times: Float64Array, downbeat: Uint8Array | null, bars: Float64Array | null, subdivisions: Float64Array | null }}
 */
export function applyBeatEdits(raw, edits, limits) {
  const hasBars = edits.bars !== false && Boolean(raw.bars?.length);
  let times = Array.from(raw.times);
  let down = downbeatFlags(times, hasBars ? raw.bars : []);

  if (edits.steady) ({ times, down } = steady(times, down, limits));
  if (edits.tempo === 0.5) ({ times, down } = halfTime(times, down));
  else if (edits.tempo === 2) ({ times, down } = doubleTime(times, down));
  if (hasBars && edits.barShift) down = shiftBars(down, edits.barShift);

  const bars = hasBars ? times.filter((_, i) => down[i]) : null;
  return {
    times: Float64Array.from(times),
    downbeat: hasBars ? Uint8Array.from(down) : null,
    bars: bars && bars.length > 1 ? Float64Array.from(bars) : null,
    subdivisions: edits.subdivide > 1 ? subdivisions(times, edits.subdivide) : null,
  };
}

// One flag per beat: whether a bar starts on it. Bar starts are beats
// (core/beat-this.js), and both are in order.
function downbeatFlags(times, bars) {
  const down = new Array(times.length).fill(false);
  for (let i = 0, j = 0; i < times.length && j < bars.length;) {
    if (times[i] === bars[j]) down[i++] = (j++, true);
    else if (times[i] < bars[j]) i++;
    else j++;
  }
  return down;
}

// The local beat at each gap: the median of the gaps around it. Where
// that is about a whole multiple (or fraction) of the whole song's beat,
// the model counted that stretch at another level (a verse in half
// time): it's brought to the song's level, so the grid fills (or thins)
// there too, while a slow drift in tempo is still followed.
function localPeriods(times, span, tolerance) {
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  const half = Math.floor(span / 2);
  const overall = medianOf(gaps);
  return gaps.map((_, i) => {
    const local = medianOf(gaps.slice(Math.max(0, i - half), i + half + 1));
    const ratio = local / overall;
    const multiple = Math.round(ratio >= 1 ? ratio : 1 / ratio);
    if (multiple < 2) return local;
    const off = Math.abs((ratio >= 1 ? ratio : 1 / ratio) / multiple - 1);
    if (off > tolerance) return local;
    return ratio >= 1 ? local / multiple : local * multiple;
  });
}

function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function steady(times, down, limits) {
  if (times.length < 3) return { times, down };
  const periods = localPeriods(times, limits.periodBeats, limits.fillTolerance);
  // The local beat around beat i (its gaps are i − 1 and i).
  const periodAt = (i) => periods[Math.min(Math.max(i - 1, 0), periods.length - 1)];

  // Strays: of two beats too close together, keep a bar start, or else the
  // one nearer where the beat before them says the next should be.
  /** @type {{ t: number, down: boolean, i: number }[]} */
  const kept = [];
  for (let i = 0; i < times.length; i++) {
    const beat = { t: times[i], down: down[i], i };
    const last = kept.at(-1);
    if (!last || beat.t - last.t >= limits.dropBelow * periodAt(i)) {
      kept.push(beat);
      continue;
    }
    if (last.down !== beat.down) {
      if (beat.down) kept[kept.length - 1] = beat;
      continue;
    }
    const before = kept.at(-2);
    if (!before) continue; // the first beat stays
    const expected = before.t + periodAt(i);
    if (Math.abs(beat.t - expected) < Math.abs(last.t - expected)) kept[kept.length - 1] = beat;
  }

  // Gaps: a whole number of beats (within the tolerance) gets the missing ones.
  const outTimes = [];
  const outDown = [];
  for (let k = 0; k < kept.length; k++) {
    outTimes.push(kept[k].t);
    outDown.push(kept[k].down);
    const next = kept[k + 1];
    if (!next) break;
    const period = periodAt(next.i);
    const gap = next.t - kept[k].t;
    const count = Math.round(gap / period);
    if (count < 2 || count > limits.maxFill || Math.abs(gap / count - period) > limits.fillTolerance * period) continue;
    for (let n = 1; n < count; n++) {
      outTimes.push(kept[k].t + (gap * n) / count);
      outDown.push(false);
    }
  }

  // Stray bar starts: one too soon after the previous bar isn't a bar start.
  const barLength = medianGap(outTimes.filter((_, i) => outDown[i]));
  if (barLength) {
    let previous = -Infinity;
    for (let i = 0; i < outTimes.length; i++) {
      if (!outDown[i]) continue;
      if (outTimes[i] - previous < limits.barDropBelow * barLength) outDown[i] = false;
      else previous = outTimes[i];
    }
  }
  return { times: outTimes, down: outDown };
}

// Every other beat, and every other bar start. Which beats stay (the odd
// or the even ones) follows the bar starts: at each, the side most of the
// bar starts around it fall on (HALF_TIME_VOTE either way), so one bar of
// an odd length doesn't break the grid. A bar start on a beat that goes
// moves to the beat before (or after) it. Without bars, the even ones.
const HALF_TIME_VOTE = 4;

function halfTime(times, down) {
  const bars = down.flatMap((isDown, i) => (isDown ? [i] : []));
  const sides = bars.map((_, k) => {
    let odd = 0;
    const around = bars.slice(Math.max(0, k - HALF_TIME_VOTE), k + HALF_TIME_VOTE + 1);
    for (const i of around) odd += i % 2;
    return 2 * odd === around.length ? bars[k] % 2 : Number(2 * odd > around.length);
  });
  // The side at beat i: that of the last bar start up to it (or the first).
  const keep = new Array(times.length).fill(false);
  for (let i = 0, k = 0; i < times.length; i++) {
    while (k + 1 < bars.length && bars[k + 1] <= i) k++;
    keep[i] = i % 2 === (bars.length ? sides[k] : 0);
  }
  const moved = new Array(times.length).fill(false);
  for (const i of bars) {
    const to = keep[i] ? i : i > 0 && keep[i - 1] ? i - 1 : i + 1 < times.length && keep[i + 1] ? i + 1 : -1;
    if (to >= 0) moved[to] = true;
  }
  const outTimes = [];
  const outDown = [];
  let bar = 0;
  for (let i = 0; i < times.length; i++) {
    if (!keep[i]) continue;
    outTimes.push(times[i]);
    outDown.push(moved[i] && bar++ % 2 === 0);
  }
  return { times: outTimes, down: outDown };
}

// A beat halfway between each two; bars stay where they are.
function doubleTime(times, down) {
  const outTimes = [];
  const outDown = [];
  for (let i = 0; i < times.length; i++) {
    outTimes.push(times[i]);
    outDown.push(down[i]);
    if (i + 1 < times.length) {
      outTimes.push((times[i] + times[i + 1]) / 2);
      outDown.push(false);
    }
  }
  return { times: outTimes, down: outDown };
}

// Each bar start `shift` beats later (earlier if negative); one moved off
// either end is gone.
function shiftBars(down, shift) {
  const out = new Array(down.length).fill(false);
  for (let i = 0; i < down.length; i++) if (down[i] && i + shift >= 0 && i + shift < down.length) out[i + shift] = true;
  return out;
}

/** `parts` − 1 evenly spaced times between each two beats. */
function subdivisions(times, parts) {
  const out = [];
  for (let i = 0; i + 1 < times.length; i++) {
    const gap = times[i + 1] - times[i];
    for (let n = 1; n < parts; n++) out.push(times[i] + (gap * n) / parts);
  }
  return Float64Array.from(out);
}
