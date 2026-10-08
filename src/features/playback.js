/* =====================================================================
 * PLAYBACK ACTIONS
 * What buttons and shortcuts call. Each is synchronous: playback is
 * scheduled on the audio clock, so nothing needs to be awaited.
 * ===================================================================== */

import { player, settings } from "../context.js";
import { dom, guarded, onClick, reportError } from "../ui/dom.js";

export function play() {
  // Only needed if the system suspended the audio; scheduled playback
  // simply waits on the audio clock until it runs.
  player.engine.resume()?.catch(reportError);
  player.transport.play();
}

// `event` (optional) is the key or click that asked for it: pausing uses its
// timestamp to stop exactly at what was being heard at that moment.
export const pause = (event) => player.transport.pause(event?.timeStamp);
export const stop = () => player.transport.stop();
// Pause, or resume from where playback is now (comma).
export const togglePlay = (event) => (player.transport.playing ? pause(event) : play());
// Moves the cursor one step (settings.stepSize) back or forward.
const step = (direction) => player.transport.seek(player.transport.position + direction * settings.stepSize);
export const stepBack = () => step(-1);
export const stepForward = () => step(1);

// Where you last started listening: where playback last started, or where
// it was last moved to (click, step, loop wrap); 0 after Stop. Kept up to
// date by the transport listeners in bindPlayback().
let returnPoint = null;

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
}

// Keeps returnPoint up to date, and releases held keys when the window
// loses focus (their key-up would be missed).
export function bindPlayback() {
  // Where Space plays from next (see replayOrPause): where playback
  // last started, or where it was last moved to.
  player.transport.on("state", (state) => {
    if (state === "playing") returnPoint = player.transport.position;
    else if (state === "stopped" || state === "ready") returnPoint = 0;
  });
  player.transport.on("jump", (time) => {
    returnPoint = time;
  });

  window.addEventListener("blur", () => {
    for (const code of [...heldKeys]) guarded(releaseHold)({ code, timeStamp: performance.now() });
  });
}
