/* =====================================================================
 * BEATS
 * Finding the open track's beats, on demand (the ♩ chip or B):
 *   1. the beat model (Beat This!; electron/beat-model.js, through the
 *      preload's beatWindow) runs on the track one 30 s window at a time,
 *      the window around the cursor first, then the ones nearest it;
 *   2. a few workers (audio/beat-input.js, beat-worker.js) decode the file
 *      again and make each window's input (its part of a log-mel
 *      spectrogram), keeping a window or two ahead of the model, so it
 *      starts after one window's preparing, not the whole track's;
 *   3. after each window, the windows so far are joined and their beats
 *      and downbeats picked (core/beat-this.js), so the part you're
 *      working on has its beats within a few seconds, on any length;
 *   4. if the model can't run (no bridge, an unsupported system), the
 *      simple beat finder (core/beats.js) goes through the whole track
 *      instead, and its beats are used (no bars).
 * Once found, they're drawn as faint lines over the waveform, the first
 * of each bar stronger (timeline.js); the chip shows the tempo; and the
 * step size becomes "1 beat", so ← / → go from beat to beat (or bar to
 * bar with "1 bar"; features/playback.js). The chip or B then shows or
 * hides the lines. A new file forgets them (resetBeats); they aren't
 * saved in projects yet.
 *
 * The beat click (Settings › General, or Shift+B): while playing, a click
 * on each beat, higher on the first of each bar, to hear whether they're
 * right. Clicks are put on the audio clock a little ahead
 * (CONFIG.beats.clickLookaheadSeconds), where the transport's timeline
 * says each beat will play, and go out through the same volume as the
 * track; a seek, a loop change, a new speed or new beats cancel the ones
 * not yet played and work them out again.
 *
 * Snapping: while the beat lines show, loop edges and marks snap to a beat
 * close by (snapToBeat for keys, snapForDrag for drags; Alt frees a drag),
 * and beatGrids gives the beats and bars for looping by bar
 * (features/playback.js).
 * ===================================================================== */

import { CONFIG } from "../config.js";
import { openBeatInput } from "../audio/beat-input.js";
import { beatLength, beats, player, settings } from "../context.js";
import { beatsFromLogits, CHUNK, FPS, joinWindows, windowInput, windowStarts } from "../core/beat-this.js";
import { beatClockTimes, medianGap, snapTo } from "../core/beats.js";
import { setStepSize } from "../ui/controls.js";
import { dom, onClick, renderBeatInfo, showNotice } from "../ui/dom.js";
import { getPrefs, onPrefsChange, setPref } from "../ui/prefs.js";
import { notify } from "../ui/toast.js";

/**
 * The part of window.earbee (electron/preload.js) used here; missing
 * outside Electron.
 * @typedef {{ beatWindow(input: Float32Array): Promise<{ ok: true, beat: Float32Array, downbeat: Float32Array } | { ok: false, error: string }> }} BeatBridge
 */
const bridge = /** @type {BeatBridge | undefined} */ (/** @type {any} */ (window).earbee);

/** @type {import("../core/media.js").Media | null} */
let media = null; // the open track's, to read again
/** @type {ReturnType<typeof openBeatInput> | null} */
let preparing = null; // the workers preparing the model's input, while finding
let search = 0; // counts searches; one that's no longer the latest stops

// Why finding them failed, by the worker's error kind (decode-worker.js).
const FAILURES = {
  "cannot-decode": "its format can't be read for that",
  "no-audio": "it has no sound",
  "out-of-memory": "there isn't enough memory",
};

function stopPreparing() {
  preparing?.close();
  preparing = null;
}

function show() {
  player.timeline.setBeats(beats.shown ? beats.times : null, beats.downbeat);
  renderBeatInfo();
}

/**
 * Takes in what a finder found so far (all of it once `complete`).
 * @param {{ beats: Float64Array, downbeats?: Float64Array }} found
 * @param {{ method: "model" | "simple", complete: boolean, name: string }} how
 */
function take({ beats: times, downbeats = new Float64Array(0) }, { method, complete, name }) {
  const gap = medianGap(times);
  if (gap === null) {
    if (!complete) return; // nothing yet: keep going
    Object.assign(beats, { status: "none", complete: true });
    renderBeatInfo();
    showNotice(`No steady beat was found in “${name}”.`);
    return;
  }
  const first = beats.status !== "found";
  const bars = downbeats.length > 1 ? downbeats : null;
  // Downbeats are beats (core/beat-this.js), and both are in order.
  let downbeat = null;
  if (bars) {
    downbeat = new Uint8Array(times.length);
    for (let i = 0, j = 0; i < times.length && j < bars.length;) {
      if (times[i] === bars[j]) downbeat[i++] = (j++, 1);
      else if (times[i] < bars[j]) i++;
      else j++;
    }
  }
  Object.assign(beats, {
    status: "found",
    times,
    bpm: 60 / gap,
    downbeat,
    bars,
    barLength: bars ? medianGap(bars) : null,
    method,
    complete,
  });
  if (first) {
    beats.shown = true;
    setStepSize("beat");
  } else if (settings.stepSize === "bar" && !bars) setStepSize("beat");
  show();
  updateClicks();
  rescheduleClicks();
}

// The simple beat finder, through the whole track: for when the model
// can't run. A worker of its own: the others may still be preparing
// windows, which are no longer needed.
async function runSimple(mine, name) {
  preparing?.close();
  preparing = openBeatInput(media, 1);
  const found = await preparing.simple((fraction) => {
    if (mine !== search) return;
    beats.progress = fraction;
    renderBeatInfo();
  });
  if (mine === search) take(found, { method: "simple", complete: true, name });
}

// The model, window by window, each window's input prepared a little
// ahead by the workers; the simple finder if the model can't run. From
// the cursor outwards where windows can be decoded on their own (`exact`,
// see audio/beat-worker.js); otherwise from the start, as one pass over
// the track makes them.
async function runModel({ frames, exact }, mine, name) {
  const starts = windowStarts(frames);
  const cursor = player.transport.position * FPS;
  const distance = (index) => Math.abs(starts[index] + CHUNK / 2 - cursor);
  const order = exact ? [...starts.keys()].sort((a, b) => distance(a) - distance(b)) : [...starts.keys()];
  // The k-th window in that order, being prepared: as many at once as
  // there are workers, so one is always ready when the model is.
  const inputs = exact ? [] : preparing.stream(starts);
  const prepare = (k) => {
    if (!exact || k >= order.length) return;
    inputs[k] = preparing.window(starts[order[k]]);
    inputs[k].catch(() => {}); // seen when its turn comes
  };
  for (let k = 0; k < CONFIG.beats.prepareWorkers; k++) prepare(k);

  const windows = [];
  for (const [done, index] of order.entries()) {
    const spect = await inputs[done];
    inputs[done] = null;
    if (mine !== search) return; // stopped, or a new file
    prepare(done + CONFIG.beats.prepareWorkers);
    const start = starts[index];
    const { input, length } = windowInput(spect, frames, start, Math.max(start, 0));
    let answer;
    try {
      answer = bridge?.beatWindow ? await bridge.beatWindow(input) : { ok: false, error: "no beat model here" };
    } catch (error) {
      answer = { ok: false, error: String(error?.message ?? error) };
    }
    if (mine !== search) return;
    if (!answer.ok) {
      console.warn("The beat model couldn't run, so the simple beat finder's beats are used:", answer.error);
      return runSimple(mine, name);
    }
    windows[index] = { start, length, beat: answer.beat, downbeat: answer.downbeat };
    beats.progress = (done + 1) / order.length;
    const { beat, downbeat } = joinWindows(windows, frames);
    take(beatsFromLogits(beat, downbeat), { method: "model", complete: done === order.length - 1, name });
    if (beats.status === "finding") renderBeatInfo();
  }
}

async function find() {
  if (!media) return;
  stopPreparing();
  const mine = ++search;
  Object.assign(beats, { status: "finding", progress: 0 });
  renderBeatInfo();
  const name = media.name;
  const opened = openBeatInput(media, CONFIG.beats.prepareWorkers);
  preparing = opened;
  try {
    const info = await opened.info;
    if (mine !== search) return;
    // Too short for the model's input: the simple finder it is.
    if (info.frames) await runModel(info, mine, name);
    else await runSimple(mine, name);
  } catch (error) {
    // Forgets any beats found so far too (their lines, the beat step, the
    // clicks), so nothing is left that the chip no longer accounts for.
    if (mine !== search) return; // stopped meanwhile, or a new file
    resetBeats(media);
    showNotice(`Couldn't find the beats in “${name}”: ${FAILURES[error?.kind] ?? error?.message ?? error}.`);
  } finally {
    // A newer search has workers of its own; this one's are done.
    if (mine === search) stopPreparing();
  }
}

// The chip or B: find the beats; while finding, stop; once found, show or
// hide their lines.
export function beatsAction() {
  if (beats.status === "idle") find();
  else if (beats.status === "finding") resetBeats(media);
  else if (beats.status === "found") {
    beats.shown = !beats.shown;
    show();
  }
}

/**
 * A new track (or none): forgets the beats (stopping a search), and
 * remembers `media` to find its beats in. A step size of "1 beat" or
 * "1 bar" goes back to the default.
 * @param {import("../core/media.js").Media | null} next
 */
export function resetBeats(next) {
  stopPreparing();
  search++;
  media = next;
  Object.assign(beats, {
    status: "idle",
    progress: 0,
    times: null,
    bpm: null,
    downbeat: null,
    bars: null,
    barLength: null,
    method: null,
    complete: false,
    shown: true,
  });
  if (typeof settings.stepSize === "string") setStepSize(CONFIG.step.initial);
  show();
  updateClicks();
}

/* ---------- Snapping, and the grid for loops ---------- */

const snapping = () => beats.status === "found" && beats.shown;

/** A time set by a key ([ ] M R): onto a beat within a share of a beat. @param {number} time */
export const snapToBeat = (time) =>
  snapping() ? snapTo(beats.times, time, beatLength() * CONFIG.beats.snapKeyFraction) : time;

/**
 * A dragged time: onto a beat within CONFIG.beats.snapPx at this zoom.
 * @param {number} time
 * @param {number} pxPerSecond
 */
export const snapForDrag = (time, pxPerSecond) =>
  snapping() && pxPerSecond > 0 ? snapTo(beats.times, time, CONFIG.beats.snapPx / pxPerSecond) : time;

/**
 * The beats and bars, for looping by them (core/beats.js resizeLoop,
 * moveLoop), or null before they're found.
 * @returns {import("../core/beats.js").Grids | null}
 */
export const beatGrids = () =>
  beats.status === "found"
    ? { beats: beats.times, beatLength: beatLength(), bars: beats.bars, barLength: beats.barLength }
    : null;

/* ---------- The beat click ---------- */

let clickTimer = null; // while clicking
let scheduledUntil = 0; // clicks are on the audio clock up to here
let scheduledRate = 1; // at this speed
let scheduled = []; // { at, cancel }

const clicking = () => beats.status === "found" && getPrefs("general")?.beatClick && player.transport.playing;

function scheduleClicks() {
  const { engine, transport } = player;
  const now = engine.now();
  if (settings.speed !== scheduledRate) cancelClicks();
  const t0 = Math.max(now, scheduledUntil);
  const t1 = now + CONFIG.beats.clickLookaheadSeconds;
  if (t1 <= t0) return;
  const times = beatClockTimes(beats.times, {
    t0,
    t1,
    from: transport.positionAtOutput(t0),
    to: transport.positionAtOutput(t1),
    rate: settings.speed,
    loop: transport.loop,
  });
  scheduled = scheduled.filter((click) => click.at > now);
  for (const { time, index } of times) {
    scheduled.push({ at: time, cancel: engine.click(time, beats.downbeat?.[index] === 1) });
  }
  scheduledUntil = t1;
  scheduledRate = settings.speed;
}

// Cancels the clicks not yet played; the next scheduleClicks starts from now.
function cancelClicks() {
  const now = player.engine.now();
  for (const click of scheduled) if (click.at > now) click.cancel();
  scheduled = [];
  scheduledUntil = 0;
}

function updateClicks() {
  const on = clicking();
  if (on && !clickTimer) {
    clickTimer = setInterval(scheduleClicks, CONFIG.beats.clickTickMs);
    scheduleClicks();
  } else if (!on && clickTimer) {
    clearInterval(clickTimer);
    clickTimer = null;
    cancelClicks();
  }
}

// The track's timeline (or the beats) changed: work the clicks out again.
function rescheduleClicks() {
  if (!clickTimer) return;
  cancelClicks();
  scheduleClicks();
}

// Shift+B: the beat click on or off.
export function toggleBeatClick() {
  const on = !getPrefs("general")?.beatClick;
  setPref("general", "beatClick", on).catch(() => {});
  notify(
    on ? "Beat click on" : "Beat click off",
    on && beats.status !== "found" ? "Find the beats first (B)." : undefined,
  );
}

export function bindBeats() {
  onClick(dom.beatInfo, beatsAction);
  player.transport.on("state", updateClicks);
  player.transport.on("jump", rescheduleClicks);
  player.transport.on("loop", rescheduleClicks);
  onPrefsChange("general", updateClicks);
}
