/* =====================================================================
 * BEATS
 * Finding the open track's beats, on demand (the ♩ chip or B):
 *   1. audio/beat-worker.js decodes the file again and makes the beat
 *      model's input (a log-mel spectrogram) and, as a fallback, the
 *      simple beat finder's answer (core/beats.js);
 *   2. the beat model (Beat This!; electron/beat-model.js, through the
 *      preload's beatWindow) runs on the spectrogram one 30 s window at a
 *      time, the window around the cursor first, then the ones nearest
 *      it; after each, the windows so far are joined and their beats and
 *      downbeats picked (core/beat-this.js), so the part you're working
 *      on has its beats within a second or two;
 *   3. if the model can't run (no bridge, an unsupported system), the
 *      simple finder's beats are used (no bars).
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

// Decoding and the spectrogram are this share of the progress; the model the rest.
const PREPARING = 0.25;

/** @type {import("../core/media.js").Media | null} */
let media = null; // the open track's, to read again
let worker = null; // while preparing
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

function stopWorker() {
  worker?.terminate();
  worker = null;
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
 * Changes some of the project's edits to the beats (the ▾ menu).
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
  stopWorker();
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

// The model, window by window from the cursor; the simple finder's answer
// if it can't run.
async function runModel(spect, frames, simple, mine, name) {
  const starts = windowStarts(frames);
  const cursor = player.transport.position * FPS;
  const distance = (index) => Math.abs(starts[index] + CHUNK / 2 - cursor);
  const order = [...starts.keys()].sort((a, b) => distance(a) - distance(b));
  const windows = [];
  for (const [done, index] of order.entries()) {
    const { input, length } = windowInput(spect, frames, starts[index]);
    let answer;
    try {
      answer = bridge?.beatWindow ? await bridge.beatWindow(input) : { ok: false, error: "no beat model here" };
    } catch (error) {
      answer = { ok: false, error: String(error?.message ?? error) };
    }
    if (mine !== search) return; // stopped, or a new file
    if (!answer.ok) {
      console.warn("The beat model couldn't run, so the simple beat finder's beats are used:", answer.error);
      return take(simple, { method: "simple", complete: true, name });
    }
    windows[index] = { start: starts[index], length, beat: answer.beat, downbeat: answer.downbeat };
    beats.progress = PREPARING + ((1 - PREPARING) * (done + 1)) / order.length;
    const { beat, downbeat } = joinWindows(windows, frames);
    take(beatsFromLogits(beat, downbeat), { method: "model", complete: done === order.length - 1, name });
    if (beats.status === "finding") renderBeatInfo();
  }
}

function find() {
  if (!media) return;
  stopWorker();
  const mine = ++search;
  Object.assign(beats, { status: "finding", progress: 0 });
  renderBeatInfo();
  const name = media.name;
  const prepared = new Worker(new URL("../audio/beat-worker.js", import.meta.url), { type: "module" });
  worker = prepared;

  // Forgets any beats found so far too (their lines, the beat step, the
  // clicks), so nothing is left that the chip no longer accounts for.
  const fail = (reason) => {
    if (mine !== search) return; // stopped meanwhile, or a new file
    resetBeats(media);
    showNotice(`Couldn't find the beats in “${name}”: ${reason}.`);
  };
  prepared.onmessage = ({ data }) => {
    if (worker !== prepared) return; // stopped meanwhile
    if (data.type === "progress") {
      beats.progress = data.fraction * PREPARING;
      renderBeatInfo();
    } else if (data.type === "done") {
      stopWorker();
      beats.progress = PREPARING;
      renderBeatInfo();
      const { spect, frames, simple } = data;
      if (!frames) take(simple, { method: "simple", complete: true, name });
      else runModel(spect, frames, simple, mine, name).catch((error) => fail(String(error?.message ?? error)));
    } else if (data.type === "error") {
      fail(FAILURES[data.kind] ?? data.message);
    }
  };
  prepared.onerror = (event) => {
    if (worker === prepared) fail(event.message || "something went wrong");
  };
  prepared.postMessage({ type: "prepare", media });
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
  stopWorker();
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

// "Find the beats again" (the ▾ menu): from scratch, keeping the edits.
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
  // The chip finds the beats, or stops finding them; once they're found,
  // it opens the beats menu (bindBeatMenu). B still shows or hides them.
  onClick(dom.beatInfo, () => beats.status !== "found" && beatsAction());
  bindBeatMenu();
  player.transport.on("state", updateClicks);
  player.transport.on("jump", rescheduleClicks);
  player.transport.on("loop", rescheduleClicks);
  onPrefsChange("general", () => {
    updateClicks();
    renderBeatMenu();
  });
}
