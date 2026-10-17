/* =====================================================================
 * PLAYBACK ACTIONS
 * What buttons and shortcuts call, and the A–B loop. Each is synchronous:
 * playback is scheduled on the audio clock, so nothing needs to be awaited.
 * ===================================================================== */

import { CONFIG } from "../config.js";
import { hasAudio, player, settings } from "../context.js";
import { formatTrackTime } from "../core/format.js";
import { cycleStepSize } from "../ui/controls.js";
import { dom, guarded, onClick, renderLoopInfo, reportError } from "../ui/dom.js";

function play() {
  // Only needed if the system suspended the audio; scheduled playback
  // simply waits on the audio clock until it runs.
  player.engine.resume()?.catch(reportError);
  player.transport.play();
}

// `event` (optional) is the key or click that asked for it: pausing uses its
// timestamp to stop exactly at what was being heard at that moment.
const pause = (event) => player.transport.pause(event?.timeStamp);
// Stop also marks where it was stopped (the stop point), from what was
// being heard at the key press, before the cursor goes back to 0.
export function stop(event) {
  const { transport } = player;
  if (transport.playing) setStopPoint(transport.positionAt(event?.timeStamp ?? performance.now()));
  transport.stop();
}
// Pause, or resume from where playback is now (comma).
export const togglePlay = (event) => (player.transport.playing ? pause(event) : play());
// Moves the cursor one step (settings.stepSize) back or forward.
const step = (direction) => player.transport.seek(player.transport.position + direction * settings.stepSize);
export const stepBack = () => step(-1);
export const stepForward = () => step(1);

// Where you last started listening: where playback last started, or where
// it was last moved to (click, step, loop wrap) or set to (S, dragging the
// green start point); 0 after Stop. Kept up to date by the transport
// listeners in bindPlayback().
let returnPoint = null;

// The start point: where Space plays from next. The transport has the
// last word (from the top after the end, inside an active loop), so this
// is always where playback really starts.
const startPoint = () => player.transport.playStartFor(returnPoint ?? player.transport.position);

// Shows the start point: the green line on the waveform and the minimap,
// and the readout in the transport bar.
function showStartPoint() {
  const loaded = hasAudio();
  const time = loaded ? startPoint() : null;
  player.timeline.setStartPoint(time);
  dom.startPointButton.hidden = !loaded;
  if (loaded) dom.startPointButton.textContent = `▶ ${formatTrackTime(time)}`;
}

// The stop point: where playback last stopped (paused, stopped or reached
// the end), shown as the red ■ on the ruler and line, and as the red
// readout next to the start point's; null before the first stop.
let stopPoint = null;

/** @param {number | null} time */
function setStopPoint(time) {
  stopPoint = time;
  player.timeline.setStopPoint(time);
  dom.stopPointButton.hidden = time === null;
  if (time !== null) dom.stopPointButton.textContent = `■ ${formatTrackTime(time)}`;
}

/** Where Space plays from next, as set (before the loop has its say). */
export const getStartPoint = () => returnPoint ?? player.transport.position;

/** Space plays from `time` next (dragging the start point). @param {number} time */
export function setStartPoint(time) {
  returnPoint = time;
  showStartPoint();
}

// S: Space plays from here next time: what is being heard while playing
// (without stopping), or the cursor while paused.
/** @param {KeyboardEvent} event */
export const startHere = (event) => setStartPoint(player.transport.positionAt(event.timeStamp));

// Pause, or play again from where you started listening (Space and the
// Play button, like Transcribe!). The cursor stays where it paused, so
// the spot stays visible; a click or step while paused moves the start.
export function replayOrPause(event) {
  if (player.transport.playing) return pause(event);
  // Read first: the seek below moves returnPoint itself.
  const from = returnPoint;
  if (from !== null && from !== player.transport.position) player.transport.seek(from);
  play();
}

// Enter: pause, or play again from where playback last stopped (the red
// stop point), where Space plays from where it last started. Before the
// first stop, from the cursor.
export function replayFromStopOrPause(event) {
  if (player.transport.playing) return pause(event);
  if (stopPoint !== null && stopPoint !== player.transport.position) player.transport.seek(stopPoint);
  play();
}

// Play-while-held: keys currently held, and whether playback was already
// running when the first one went down (then releasing keeps it running).
const heldKeys = new Set();
let playingBeforeHold = false;

export function holdToPlay(event) {
  if (heldKeys.size === 0) playingBeforeHold = player.transport.playing;
  heldKeys.add(event.code);
  play();
}

export function releaseHold(event) {
  if (!heldKeys.delete(event.code)) return;
  if (heldKeys.size === 0 && !playingBeforeHold) pause(event);
}

// The transport buttons.
export function bindTransportButtons() {
  onClick(dom.playButton, replayOrPause);
  onClick(dom.stopButton, stop);
  onClick(dom.stepBackButton, stepBack);
  onClick(dom.stepForwardButton, stepForward);
  onClick(dom.stepSize, (event) => cycleStepSize(event.shiftKey ? -1 : 1));
  onClick(dom.startPointButton, () => player.transport.seek(startPoint()));
  onClick(dom.stopPointButton, () => stopPoint !== null && player.transport.seek(stopPoint));
}

// Keeps returnPoint up to date, and releases held keys when the window
// loses focus (their key-up would be missed).
export function bindPlayback() {
  // Where Space plays from next (see replayOrPause): where playback
  // last started, or where it was last moved to.
  player.transport.on("state", (state) => {
    if (state === "playing") returnPoint = player.transport.position;
    else if (state === "stopped" || state === "ready") returnPoint = 0;
    showStartPoint();
    // Where it stopped (Stop marks it itself, before going back to 0).
    if (state === "paused" || state === "ended") setStopPoint(player.transport.position);
    else if (state === "ready") setStopPoint(null);
  });
  player.transport.on("jump", (time) => {
    returnPoint = time;
    showStartPoint();
  });
  // With a loop on, Space starts inside it.
  player.transport.on("loop", showStartPoint);
  showStartPoint();

  window.addEventListener("blur", () => {
    for (const code of [...heldKeys]) guarded(releaseHold)({ code, timeStamp: performance.now() });
  });
}

/* ---------- The A–B loop ---------- */

// The A–B loop: its state and the actions on it. The transport loops the
// audio (audio/transport.js); the waveform draws it and lets it be dragged
// (waveform.js).

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

/** The loop as it is now, or null. @returns {LoopRegion | null} */
export const getLoopRegion = () => loopRegion && { ...loopRegion };

export const toggleLoop = () => loopRegion && setLoopRegion({ ...loopRegion, enabled: !loopRegion.enabled });
export const clearLoop = () => setLoopRegion(null);
