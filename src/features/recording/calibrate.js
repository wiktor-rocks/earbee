// Recording (src/features/recording/): measuring the delay the system
// doesn't report. Clicks are played at known times while the input is
// recorded, with the input hearing the output (a cable from an output to
// the input, or a microphone at the speaker); where each click turns up in
// the recording, against where it would with nothing unreported, is what
// the nudge has to be. Pure: index.js plays the clicks and records.
//
//   clickDelay(recording, times, options)  → { delay, found, spread } (seconds), or null if the clicks didn't come in

/**
 * @param {import("./takes.js").Recording} recording Its `time` on the render clock (takes.js), as a take's.
 * @param {number[]} times When each click was rendered (the same clock).
 * @param {object} options
 * @param {number} options.before How long before a click's time it's looked for (seconds), and
 * @param {number} options.after how long after.
 * @param {number} options.onset A click starts where the level first reaches this share of its loudest sample.
 * @param {number} options.floor A click has to be louder than this (0…1), and
 * @param {number} options.overNoise this many times the recording's usual level.
 * @param {number} options.agree The clicks kept are within this (seconds) of the middle one.
 * @returns {{ delay: number, found: number, spread: number } | null} Null unless at least half the clicks agree.
 */
export function clickDelay(recording, times, { before, after, onset, floor, overNoise, agree }) {
  const { samples, sampleRate, time } = recording;
  if (!samples.length || !times.length) return null;

  // The usual level: the median of a spread of samples (the clicks are a small part of it).
  const stride = Math.max(1, Math.floor(samples.length / 4096));
  const levels = [];
  for (let i = 0; i < samples.length; i += stride) levels.push(Math.abs(samples[i]));
  levels.sort((a, b) => a - b);
  const loud = Math.max(floor, levels[levels.length >> 1] * overNoise);

  const delays = [];
  for (const at of times) {
    const from = Math.max(0, Math.round((at - before - time) * sampleRate));
    const to = Math.min(samples.length, Math.round((at + after - time) * sampleRate));
    let peak = 0;
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(samples[i]));
    if (peak < loud) continue;
    for (let i = from; i < to; i++) {
      if (Math.abs(samples[i]) < peak * onset) continue;
      delays.push(time + i / sampleRate - at);
      break;
    }
  }
  if (!delays.length) return null;

  delays.sort((a, b) => a - b);
  const middle = delays[delays.length >> 1];
  const kept = delays.filter((delay) => Math.abs(delay - middle) <= agree);
  if (kept.length * 2 < times.length) return null;
  return { delay: kept[kept.length >> 1], found: kept.length, spread: kept.at(-1) - kept[0] };
}
