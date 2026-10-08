// The A–B loop: its state and the actions on it. The transport loops the
// audio (audio/transport.js); the waveform draws it and lets it be dragged
// (waveform.js).
import { CONFIG } from "../config.js";
import { player } from "../context.js";
import { renderLoopInfo } from "../ui/dom.js";

/** @typedef {import("../core/timeline.js").LoopRegion} LoopRegion */
/** @type {LoopRegion | null} */
let loopRegion = null;

/** @param {LoopRegion | null} region Too short (or null) removes the loop. */
export function setLoopRegion(region) {
  const valid = region && region.end - region.start >= CONFIG.loop.minSeconds;
  loopRegion = valid ? { start: region.start, end: region.end, enabled: region.enabled } : null;
  player.transport.setLoop(loopRegion?.enabled ? loopRegion : null);
  player.waveform.setLoop(loopRegion);
  renderLoopInfo(loopRegion);
}

// [ and ]: move one end of the loop to the cursor, keeping the other end
// if it still makes a loop, and turn the loop on.
export function setLoopStart() {
  const start = player.transport.position;
  const end = loopRegion && loopRegion.end > start ? loopRegion.end : player.transport.duration;
  setLoopRegion({ start, end, enabled: true });
}

export function setLoopEnd() {
  const end = player.transport.position;
  const start = loopRegion && loopRegion.start < end ? loopRegion.start : 0;
  setLoopRegion({ start, end, enabled: true });
}

export const toggleLoop = () => loopRegion && setLoopRegion({ ...loopRegion, enabled: !loopRegion.enabled });
export const clearLoop = () => setLoopRegion(null);
