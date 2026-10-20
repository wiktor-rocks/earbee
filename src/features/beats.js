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
 * bar with "1 bar"; features/playback.js). B then shows or hides the
 * lines. A new file forgets them (resetBeats); a project saves
 * them and brings them back (restoreBeats; features/project/sections.js),
 * so they aren't looked for again.
 *
 * Once found, a click on the chip opens the beats menu: the lines shown or
 * not, the beat click, and editing them. What the finder found is kept as
 * `beats.raw`, and the project's edits (core/beat-edits.js: a steady grid,
 * half or double time, bar starts moved, subdivisions) are applied to it
 * again whenever one changes (setBeatEdits). Everything else reads the
 * edited beats, so stepping, loops, snapping and the click follow.
 * Turning bars off (no strong first beat) leaves the beats as the simple
 * finder's are: all alike, no bar steps, \ loops a beat.
 *
 * The beat click (the beats menu, or Shift+B): while playing, a click
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
import { applyBeatEdits } from "../core/beat-edits.js";
import { beatsFromLogits, CHUNK, FPS, joinWindows, windowInput, windowStarts } from "../core/beat-this.js";
import { beatClockTimes, medianGap, snapTo } from "../core/beats.js";
import { createEmitter } from "../core/emitter.js";
import { setStepSize } from "../ui/controls.js";
import { dom, onClick, renderBeatInfo, showNotice } from "../ui/dom.js";
import { bindMenu } from "../ui/menu.js";
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
let revision = 0; // counts the beats found or restored, for unsaved changes

// "found": the beat model finished on its own, with nothing clicked, so
// the project checks for unsaved changes (features/project/index.js).
export const beatEvents = createEmitter();

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
  const shown = beats.shown ? beats : null;
  player.timeline.setBeats(shown?.times ?? null, beats.downbeat, shown?.subdivisions ?? null);
  renderBeatInfo();
  renderBeatMenu();
}

// The edited beats from `beats.raw` and `beats.edits`.
function applyEdits() {
  const edited = applyBeatEdits(beats.raw, beats.edits, CONFIG.beats.steady);
  Object.assign(beats, {
    ...edited,
    bpm: 60 / (medianGap(edited.times) ?? medianGap(beats.raw.times)),
    barLength: edited.bars ? medianGap(edited.bars) : null,
  });
}

// New beats, or new edits: everything that uses them follows.
function refresh() {
  if (settings.stepSize === "bar" && !beats.bars) setStepSize("beat");
  show();
  updateClicks();
  rescheduleClicks();
}

/**
 * Takes in what a finder found so far (all of it once `complete`).
 * @param {{ beats: Float64Array, downbeats?: Float64Array }} found
 * @param {{ method: "model" | "simple", complete: boolean, name: string }} how
 */
function take({ beats: times, downbeats = new Float64Array(0) }, { method, complete, name }) {
  if (medianGap(times) === null) {
    if (!complete) return; // nothing yet: keep going
    Object.assign(beats, { status: "none", complete: true });
    renderBeatInfo();
    showNotice(`No steady beat was found in “${name}”.`);
    return;
  }
  const first = beats.status !== "found";
  Object.assign(beats, {
    status: "found",
    raw: { times, bars: downbeats.length > 1 ? downbeats : null },
    method,
    complete,
  });
  if (complete) {
    revision++;
    beatEvents.emit("found");
  }
  applyEdits();
  if (first) {
    beats.shown = true;
    setStepSize("beat");
  }
  refresh();
}

/**
 * Changes some of the project's edits to the beats (the beats menu).
 * @param {Partial<import("../core/beat-edits.js").BeatEdits>} changes
 */
export function setBeatEdits(changes) {
  beats.edits = { ...beats.edits, ...changes };
  if (beats.status !== "found") return renderBeatMenu();
  applyEdits();
  refresh();
}

/**
 * Brings back beats a project saved (features/project/sections.js), as
 * found, so they aren't looked for again.
 * @param {{ times: Float64Array, bars: Float64Array | null, method: "model" | "simple", edits: import("../core/beat-edits.js").BeatEdits }} saved
 */
export function restoreBeats({ times, bars, method, edits }) {
  stopPreparing();
  search++;
  Object.assign(beats, {
    status: "found",
    progress: 1,
    raw: { times, bars },
    edits,
    method,
    complete: true,
    shown: true,
  });
  revision++;
  applyEdits();
  refresh();
}

/**
 * What a project saves of the beats: what was found and the edits, once
 * all of it is found; null otherwise. `revision` changes with each new
 * finding, so comparing it (and the edits) tells an unsaved change
 * without comparing every beat.
 */
export function savedBeats() {
  if (beats.status !== "found" || !beats.complete) return null;
  return { revision, raw: beats.raw, method: beats.method, edits: beats.edits };
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

// B: find the beats; while finding, stop; once found, show or hide their
// lines. (The chip has its own handler: see bindBeats.)
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
    subdivisions: null,
    raw: null,
    edits: { ...CONFIG.beats.edits },
    method: null,
    complete: false,
    shown: true,
  });
  if (typeof settings.stepSize === "string") setStepSize(CONFIG.step.initial);
  show();
  updateClicks();
}

// "Find the beats again" (the beats menu): from scratch, keeping the edits.
function findAgain() {
  const { edits } = beats;
  resetBeats(media);
  beats.edits = edits;
  find();
}

/* ---------- Snapping, and the grid for loops ---------- */

const snapping = () => beats.status === "found" && beats.shown;

// Onto the nearest beat or subdivision within `within` seconds.
function snapToGrid(time, within) {
  const onBeat = snapTo(beats.times, time, within);
  const onPart = snapTo(beats.subdivisions, time, within);
  if (onPart === time) return onBeat;
  if (onBeat === time) return onPart;
  return Math.abs(onPart - time) < Math.abs(onBeat - time) ? onPart : onBeat;
}

/**
 * A time set by a key ([ ] M R): onto a beat (or subdivision) within a
 * share of one.
 * @param {number} time
 */
export const snapToBeat = (time) =>
  snapping() ? snapToGrid(time, (beatLength() * CONFIG.beats.snapKeyFraction) / beats.edits.subdivide) : time;

/**
 * A dragged time: onto a beat (or subdivision) within CONFIG.beats.snapPx
 * at this zoom.
 * @param {number} time
 * @param {number} pxPerSecond
 */
export const snapForDrag = (time, pxPerSecond) =>
  snapping() && pxPerSecond > 0 ? snapToGrid(time, CONFIG.beats.snapPx / pxPerSecond) : time;

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

/* ---------- The beats menu (a click on the chip, once they're found) ---------- */

// While it's open, the app's shortcuts wait (app.js), as for the File menu.
export const isBeatMenuOpen = () => dom.beatMenu.matches(":popover-open");

/** @param {string} selector */
const menuItems = (selector) => /** @type {HTMLElement[]} */ ([...dom.beatMenu.querySelectorAll(selector)]);

// The items show what's on. The menu opens once there are beats (found,
// or found so far, so edits can be chosen while the model fills in the rest).
function renderBeatMenu() {
  if (beats.status !== "found" && isBeatMenuOpen()) dom.beatMenu.hidePopover();
  const { edits } = beats;
  const check = (item, on) => item.setAttribute("aria-checked", String(on));
  for (const item of menuItems("[data-shown]")) check(item, beats.shown);
  for (const item of menuItems("[data-click]")) check(item, Boolean(getPrefs("general")?.beatClick));
  for (const item of menuItems("[data-bars]")) check(item, edits.bars);
  for (const item of menuItems("[data-steady]")) check(item, edits.steady);
  for (const item of menuItems("[data-tempo]")) check(item, Number(item.dataset.tempo) === edits.tempo);
  for (const item of menuItems("[data-subdivide]")) check(item, Number(item.dataset.subdivide) === edits.subdivide);
  // Bars need the model's bar starts (the simple finder has none); moving
  // them, bars that are on.
  for (const item of menuItems("[data-bars]")) item.hidden = !beats.raw?.bars;
  for (const item of menuItems("[data-bar-shift]")) item.hidden = !beats.raw?.bars || !edits.bars;
}

function bindBeatMenu() {
  bindMenu({
    menu: dom.beatMenu,
    buttons: () => [dom.beatInfo],
    anchor: "--beat-menu",
    itemSelector: ".menu-item",
    // Before the beats are found, the chip finds them (or stops) instead.
    canOpen: () => beats.status === "found",
  });
  // The menu stays open while edits are tried, to hear and see each one.
  dom.beatMenu.addEventListener("click", (event) => {
    const item = /** @type {HTMLElement} */ (event.target).closest(".menu-item");
    if (!(item instanceof HTMLElement)) return;
    const { shown, click, bars, steady, tempo, subdivide, barShift, findAgain: again } = item.dataset;
    if (shown !== undefined) {
      beats.shown = !beats.shown;
      show();
    } else if (click !== undefined) toggleBeatClick();
    else if (bars !== undefined) setBeatEdits({ bars: !beats.edits.bars });
    else if (steady !== undefined) setBeatEdits({ steady: !beats.edits.steady });
    else if (tempo)
      setBeatEdits({ tempo: Number(tempo) === beats.edits.tempo ? 1 : /** @type {0.5 | 2} */ (Number(tempo)) });
    else if (subdivide) setBeatEdits({ subdivide: /** @type {1 | 2 | 3 | 4} */ (Number(subdivide)) });
    else if (barShift) {
      const max = CONFIG.beats.maxBarShift;
      setBeatEdits({ barShift: Math.max(-max, Math.min(max, beats.edits.barShift + Number(barShift))) });
    } else if (again !== undefined) {
      dom.beatMenu.hidePopover();
      findAgain();
    }
  });
}

export function bindBeats() {
  // The chip finds the beats; once they're found (some of them, while
  // the model goes on), it opens the beats menu (bindBeatMenu). Clicking
  // it while finding does nothing: only B stops a search, so a stray
  // click doesn't throw the work away. B also shows or hides the lines.
  onClick(dom.beatInfo, () => beats.status === "idle" && beatsAction());
  bindBeatMenu();
  player.transport.on("state", updateClicks);
  player.transport.on("jump", rescheduleClicks);
  player.transport.on("loop", rescheduleClicks);
  onPrefsChange("general", () => {
    updateClicks();
    renderBeatMenu();
  });
}
