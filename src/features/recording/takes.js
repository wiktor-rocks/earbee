// Recording (src/features/recording/): what a take is, cutting a recording
// into takes (one per pass around the loop), and where a take plays when
// the track does. Pure: no DOM, no audio.
//
// Two clocks meet here. The track's position is known at the time the
// player renders it (the AudioContext clock; audio/transport.js
// positionAtOutput). What's played along to it is heard later, by the
// output's delay, and comes back into the player later again, by the
// input's. capture.js takes both delays off, so a recording's `time` is on
// the render clock: the sample at `time` was played while the track's
// position rendered at `time` was heard. What the system doesn't report of
// the delay is the nudge, taken off when a take plays.
//
//   passes(anchor, endTime, loop, duration)  the stretches of the track a recording ran over
//   cutTakes(recording, passes, options)     a take for each
//   takeOffset(take, position, nudge)        seconds into a take's samples for a track position
//   planChunk(take, from)                    what to play of a take from a moment on

/** @typedef {import("../../core/timeline.js").Loop} Loop */

/**
 * One stretch of the track a recording ran over without a jump: the track
 * from `start` to `end` (seconds), rendered from `from` to `to` (the
 * AudioContext clock).
 * @typedef {{ from: number, to: number, start: number, end: number }} Pass
 */

/**
 * What was recorded: mono samples at `sampleRate`, the first at `time` on
 * the render clock (see above).
 * @typedef {{ samples: Float32Array, sampleRate: number, time: number }} Recording
 */

/**
 * A take: what was played over the track from `start` to `end` (seconds),
 * at the speed `rate`. Its samples start `lead` samples before `start` and
 * run on past `end` (CONFIG.recording.margin), so a nudge has something to
 * move into.
 * @typedef {object} Take
 * @property {number} start
 * @property {number} end
 * @property {number} rate The speed it was recorded at (1 = normal).
 * @property {number} sampleRate
 * @property {number} lead
 * @property {Float32Array} samples
 */

/**
 * The passes of a recording that began with the track at `anchor.position`
 * rendered at `anchor.time`, playing at `anchor.rate` until `endTime`, with
 * nothing changed meanwhile. With a loop ahead of the position, playback
 * runs up to its end, then around it (audio/transport.js): each time
 * around is a pass. Without one, it's a single pass, to the track's end at
 * most.
 * @param {{ time: number, position: number, rate: number }} anchor
 * @param {number} endTime
 * @param {Loop | null} loop
 * @param {number} duration
 * @returns {Pass[]}
 */
export function passes(anchor, endTime, loop, duration) {
  const { rate } = anchor;
  const looping = loop !== null && anchor.position < loop.end;
  /** @type {Pass[]} */
  const found = [];
  let from = anchor.time;
  let start = anchor.position;
  while (from < endTime) {
    const stop = looping ? loop.end : duration;
    if (stop <= start) break;
    const to = Math.min(endTime, from + (stop - start) / rate);
    found.push({ from, to, start, end: start + (to - from) * rate });
    if (!looping) break;
    from = to;
    start = loop.start;
  }
  return found;
}

/**
 * A take for each pass at least `minSeconds` long (a shorter one is a
 * slip, not a take), with up to `margin` seconds of the recording kept
 * before and after it.
 * @param {Recording} recording
 * @param {Pass[]} found
 * @param {{ rate: number, margin: number, minSeconds: number }} options
 * @returns {Take[]}
 */
export function cutTakes(recording, found, { rate, margin, minSeconds }) {
  const { samples, sampleRate, time } = recording;
  const index = (at) => Math.round((at - time) * sampleRate);
  /** @type {Take[]} */
  const takes = [];
  for (const pass of found) {
    // Only what was recorded of it.
    const first = Math.max(0, index(pass.from));
    const last = Math.min(samples.length, index(pass.to));
    if (last - first < minSeconds * sampleRate) continue;
    const begin = Math.max(0, first - Math.round(margin * sampleRate));
    const finish = Math.min(samples.length, last + Math.round(margin * sampleRate));
    takes.push({
      // Where the first sample kept of the pass belongs on the track.
      start: pass.start + (time + first / sampleRate - pass.from) * rate,
      end: pass.start + (time + last / sampleRate - pass.from) * rate,
      rate,
      sampleRate,
      lead: first - begin,
      samples: samples.slice(begin, finish),
    });
  }
  return takes;
}

/**
 * How far into a take's samples (seconds) the track's `position` is. A
 * `nudge` (seconds) above 0 says the recording came in later than the
 * system reported, so what belongs to a position is that much further in.
 * @param {Take} take @param {number} position @param {number} nudge
 */
export function takeOffset(take, position, nudge) {
  return take.lead / take.sampleRate + (position - take.start) / take.rate + nudge;
}

/**
 * What to play of a take while the track plays on from `position`,
 * rendered at `time`, at the take's speed, up to where the track next
 * jumps: the end of a loop ahead (`next` is then where it goes on, the
 * loop's start, at `until`) or the track's end (`next` is null).
 * `source`: start the take's samples at `when` (the AudioContext clock),
 * `offset` seconds in, for `length` seconds; null where this stretch has
 * nothing of the take.
 * @param {Take} take
 * @param {{ time: number, position: number, loop: Loop | null, duration: number, nudge: number }} from
 * @returns {{ until: number, next: number | null, source: { when: number, offset: number, length: number } | null }}
 */
export function planChunk(take, { time, position, loop, duration, nudge }) {
  const looping = loop !== null && position < loop.end;
  const stop = looping ? loop.end : duration;
  const until = time + Math.max(0, stop - position) / take.rate;
  const next = looping ? loop.start : null;

  const start = Math.max(position, take.start);
  const end = Math.min(stop, take.end);
  if (end <= start) return { until, next, source: null };

  let when = time + (start - position) / take.rate;
  let offset = takeOffset(take, start, nudge);
  let length = (end - start) / take.rate;
  // A nudge can ask for more than the margins kept: play what there is.
  if (offset < 0) {
    when -= offset;
    length += offset;
    offset = 0;
  }
  length = Math.min(length, take.samples.length / take.sampleRate - offset);
  return { until, next, source: length > 0 ? { when, offset, length } : null };
}
