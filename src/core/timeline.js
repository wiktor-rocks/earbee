// The playback timeline: where the track is at a given clock time.
import { clamp } from "./format.js";

/**
 * One stretch of the playback timeline (Signalsmith's and the transport's
 * copy of it): from `outputTime` on, the track plays from `input` at
 * `rate`, or rests at `input` if not active.
 * @typedef {object} Segment
 * @property {number} outputTime When it starts, in seconds on the AudioContext clock.
 * @property {number} input Track position (s) at outputTime.
 * @property {number} rate Playback speed (1 = normal).
 * @property {boolean} active Playing (true) or resting (false).
 * @property {number} [loopStart] A–B loop in track seconds; 0, 0 means no loop.
 * @property {number} [loopEnd]
 */

/**
 * Position in the track at `time` (AudioContext clock), given a timeline of
 * segments, oldest first. This is the same mapping Signalsmith uses
 * internally, including its loop: once the position reaches loopEnd it
 * moves back by the loop length (segments never start at or after loopEnd,
 * see audio/transport.js).
 * @param {Segment[]} segments
 * @param {number} time
 * @param {number} duration Track length; the result is clamped to it.
 * @returns {number}
 */
export function timelinePositionAt(segments, time, duration) {
  let segment = segments[0];
  for (const candidate of segments) {
    if (candidate.outputTime > time) break;
    segment = candidate;
  }
  if (!segment) return 0;

  const elapsed = segment.active ? Math.max(0, time - segment.outputTime) : 0;
  let position = segment.input + elapsed * segment.rate;

  const { loopStart = 0, loopEnd = 0 } = segment;
  const loopLength = loopEnd - loopStart;
  if (loopLength > 0 && position >= loopEnd) {
    position = loopStart + ((position - loopStart) % loopLength);
  }
  return clamp(position, 0, duration);
}
