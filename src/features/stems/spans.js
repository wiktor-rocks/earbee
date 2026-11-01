// Stems (src/features/stems/): the parts of the song separated so far, as
// spans of samples, [[from, to], …], sorted and apart (touching ones are
// joined). Separating does the loop first and then the rest, so until it's
// done the stems cover only some of the song; elsewhere the player plays
// the song itself (the stretcher's worklet keeps the same list:
// src/vendor/signalsmith-stretch). Pure.

/** @typedef {[number, number][]} Spans */

/**
 * The spans with [from, to) added.
 * @param {Spans} spans
 * @param {number} from
 * @param {number} to
 * @returns {Spans}
 */
export function addSpan(spans, from, to) {
  if (!(from < to)) return spans;
  const touching = spans.filter(([start, end]) => end >= from && start <= to);
  const joined = /** @type {[number, number]} */ ([
    Math.min(from, ...touching.map(([start]) => start)),
    Math.max(to, ...touching.map(([, end]) => end)),
  ]);
  return [...spans.filter(([, end]) => end < from), joined, ...spans.filter(([start]) => start > to)];
}

/**
 * The parts of [from, from + count) the spans cover, as [start, end) pairs.
 * @param {Spans} spans
 * @param {number} from
 * @param {number} count
 * @returns {Spans}
 */
export function coveredParts(spans, from, count) {
  const to = from + count;
  const parts = [];
  for (const [start, end] of spans) {
    const a = Math.max(start, from);
    const b = Math.min(end, to);
    if (a < b) parts.push(/** @type {[number, number]} */ ([a, b]));
  }
  return parts;
}

/**
 * How many samples the spans cover.
 * @param {Spans} spans
 */
export const coveredLength = (spans) => spans.reduce((sum, [from, to]) => sum + to - from, 0);

/**
 * Whether the spans cover all of [0, length).
 * @param {Spans} spans
 * @param {number} length
 */
export const coversAll = (spans, length) => spans.some(([from, to]) => from <= 0 && to >= length);

/**
 * The spans moved to another sample rate: each sample `ratio` times as far.
 * @param {Spans} spans
 * @param {number} ratio
 * @returns {Spans}
 */
export const scaleSpans = (spans, ratio) =>
  spans.map(([from, to]) => [Math.round(from * ratio), Math.round(to * ratio)]);
