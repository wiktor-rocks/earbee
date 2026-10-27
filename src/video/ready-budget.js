// How many ready points a video gets (CONFIG.video.readyPoints; see
// view.js). A decoder waiting at a point holds about `heldFrames` decoded
// frames (Mediabunny decodes ahead, and the codec keeps its reference
// frames), each 1.5 bytes a pixel, so a big video gets fewer: within
// `maxBytes`, and within `maxMemoryShare` of the memory free now (when
// known). Pure, so it can be tested on its own.

/**
 * @param {{ width: number, height: number, available: number | null }} video
 *   Its coded size in pixels, and the memory free (bytes; null if unknown).
 * @param {{ max: number, maxBytes: number, maxMemoryShare: number, heldFrames: number }} limits
 * @returns {number} 0 … max
 */
export function readyPointsFor({ width, height, available }, { max, maxBytes, maxMemoryShare, heldFrames }) {
  if (!(width > 0 && height > 0)) return 0;
  const known = typeof available === "number" && available > 0;
  const budget = known ? Math.min(maxBytes, available * maxMemoryShare) : maxBytes;
  const each = heldFrames * width * height * 1.5;
  return Math.max(0, Math.min(max, Math.floor(budget / each)));
}
