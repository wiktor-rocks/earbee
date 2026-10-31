/* =====================================================================
 * STEMS
 * The open song split into its instruments (vocals, drums, bass, guitar,
 * piano, and the rest), by the stem model in the main process
 * (electron/stems/), on demand: the Stems section's button.
 *
 *   1. The first time, the model is downloaded (116 MB, once; the main
 *      process checks it).
 *   2. A worker (worker.js) decodes the song again at 44.1 kHz and streams
 *      it to the stem process, which separates it one 7.8 s segment at a
 *      time, at low priority (about as long as the song plays).
 *   3. The stems come back to the worker, which turns them into the
 *      track's rate in 16 bits, then here, and on to the player
 *      (audio/engine.js loadStems): they play through the same stretcher
 *      as the track, mixed into its input, so they keep in step at any
 *      speed, pitch or loop.
 *   4. While they already play, a few workers encode a copy of each as
 *      Opus for the project ("Preparing them for saving"). They're an
 *      unsaved change as soon as they play; a save started before their
 *      copies are made waits for them (whenPrepared).
 * Cancel, or opening another file, stops it: the worker ends, and the main
 * process stops the stem process.
 *
 * Then the section is a mixer (dock.js): each stem's volume, solo and
 * mute, turned into gains (mix.js) for the player. With every stem at full
 * volume it plays the song itself, exactly; any other mix is the sum of
 * the six stems (so a muted one is gone, with nothing of it left).
 *
 * Self-contained: this folder, its stems.css, electron/stems/, and the
 * lines marked "Stems (" (app.js, open-file.js, index.html, config.js,
 * main.js, preload.js). With CONFIG.stems.enabled off, the section is
 * removed and nothing else happens.
 *
 *   bindStems()        builds the section (once, at startup)
 *   resetStems(media)  a new file is open: what was found is forgotten
 *   stemsFound()       what was found for the open song (else null)
 *   stemsToSave(), stemsRevision(), whenPrepared(), loadStems(saved)
 *                      for the project (project.js)
 * ===================================================================== */

import { CONFIG } from "../../config.js";
import { player } from "../../context.js";
import { AppError } from "../../core/errors.js";
import { $, element, onClick, reportError } from "../../ui/dom.js";
import { notify } from "../../ui/toast.js";
import { buildMixer } from "./dock.js";
import { defaultMix, isUnchanged, stemMixes } from "./mix.js";

/**
 * The part of window.earbee (electron/preload.js) used here; missing
 * outside Electron.
 * @typedef {{
 *   model(): Promise<{ ready: boolean, bytes: number }>,
 *   download(): Promise<{ ok: boolean, canceled?: boolean, error?: string }>,
 *   start(): Promise<{ ok: boolean, error?: string }>,
 *   cancel(): Promise<void>,
 *   onProgress(callback: (progress: { fraction: number }) => void): () => void,
 *   onStopped(callback: (stopped: { error: string }) => void): () => void,
 * }} StemsBridge
 */
const bridge = /** @type {StemsBridge | undefined} */ (/** @type {any} */ (window).earbee?.stems);

/**
 * What was found for the open song (the samples themselves went to the
 * player): the stems' ids in the player's order, at `sampleRate`,
 * `length` samples long, and each one's loudness.
 * @typedef {{ sampleRate: number, length: number, ids: string[], levels: Record<string, number> }} Stems
 */

/** @type {import("../../core/media.js").Media | null} */
let media = null; // the open song's, to read again
/** @type {Stems | null} */
let found = null;
/** @type {Record<string, Uint8Array> | null} */
let audio = null; // each stem as Opus, for the project (opus.js)
let revision = 0; // counts the stems separated (not those a project brings back), for unsaved changes
let modelBytes = 0;
let modelReady = false;
// What's going on: "idle", "download", "decode", "separate", "load" (from
// a project) or "ready".
let stage = "idle";
let fraction = 0;
// While new stems already play: how far encoding them for saving is (null:
// not encoding).
/** @type {number | null} */
let preparing = null;
// Each stem's volume, solo and mute (mix.js).
let mix = defaultMix(CONFIG.stems.list);
// The separation or load going on: `stops` end its workers' waits (cancel).
/** @type {{ cancelled: boolean, stops: Set<() => void> } | null} */
let job = null;

let ui = null; // the section's parts, once built

/* ---------- Separating and loading ---------- */

// The stem process's port, which the preload posts to the window after
// start() (bindStems listens); a newer wait replaces an older one.
/** @type {((port: MessagePort) => void) | null} */
let portWaiter = null;
const nextPort = () => new Promise((resolve) => (portWaiter = resolve));

/** A new job, replacing none (cancel() first). */
function startJob() {
  const current = { cancelled: false, stops: new Set() };
  job = current;
  return { current, stillCurrent: () => job === current && !current.cancelled };
}

/**
 * Runs the worker on `message` (worker.js) until it's done; its progress
 * shows meanwhile, and its stems go to `onStems` as soon as they come
 * (before the Opus copies, which `done` brings). `onProgress` (stage,
 * fraction) shows it unless given. Rejects with `null` when the job is
 * cancelled.
 * @param {{ current: { stops: Set<() => void> }, stillCurrent: () => boolean }} running
 * @param {Promise<[object, Transferable[]]>} message The message, and what it transfers.
 * @param {(error: string) => AppError} failure
 * @param {(stems: any) => Promise<unknown>} onStems
 * @param {(stage: string, fraction: number) => void} [onProgress]
 */
async function runWorker({ current, stillCurrent }, message, failure, onStems, onProgress = show) {
  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  let stopStopped = () => {};
  let stop = () => {};
  return new Promise((resolve, reject) => {
    stop = () => reject(null);
    current.stops.add(stop);
    if (bridge) stopStopped = bridge.onStopped((stopped) => reject(new AppError(stopped.error)));
    worker.addEventListener("message", ({ data }) => {
      if (data.type === "progress" && stillCurrent()) onProgress(data.stage, data.fraction);
      else if (data.type === "stems") onStems(data).catch(reject);
      else if (data.type === "done") resolve(data);
      else if (data.type === "error") reject(failure(data.message));
    });
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      reject(failure(event.message || "the worker stopped"));
    });
    message.then(
      ([data, transfer]) => worker.postMessage(data, transfer),
      (error) => reject(error),
    );
  }).finally(() => {
    current.stops.delete(stop);
    stopStopped();
    worker.terminate();
  });
}

// The worker's stems, to the player (in its order; the samples are
// transferred); then the mixer shows. Resolves false if the job ended
// meanwhile.
async function takeStems(result, stillCurrent) {
  const ids = CONFIG.stems.list.map(({ id }) => id).filter((id) => result.stems[id]);
  await player.engine.loadStems(ids.map((id) => result.stems[id]));
  if (!stillCurrent()) return false;
  const levels = Object.fromEntries(ids.map((id) => [id, result.stems[id].level]));
  found = { sampleRate: result.sampleRate, length: result.length, ids, levels };
  applyMix();
  show("ready", 1);
  return true;
}

// New stems play: they're an unsaved change from now on (a project's own
// aren't), and a save waits for their copies (whenPrepared). The project
// checks for unsaved changes after any change event (features/project/
// index.js).
function markNew() {
  revision++;
  window.dispatchEvent(new Event("change"));
}

// Saves waiting for the stems' copies for saving (whenPrepared).
/** @type {(() => void)[]} */
let preparedWaiters = [];
function releaseWaiters() {
  const waiters = preparedWaiters;
  preparedWaiters = [];
  for (const resolve of waiters) resolve();
}

// The stems' Opus copies have come: they can be saved.
function takeAudio(result) {
  audio = result.audio;
  job = null;
  preparing = null;
  render();
  releaseWaiters();
}

// The job failed: the stems that already play stay (they just can't be
// saved); before that, back to the button.
function failJob(error, what) {
  job = null;
  preparing = null;
  releaseWaiters();
  if (!found) mix = defaultMix(CONFIG.stems.list);
  show(found ? "ready" : "idle", 0);
  if (error) reportError(error instanceof AppError ? error : new AppError(`${what}: ${error.message ?? error}`, error));
}

async function separate() {
  if (!bridge || !media || job) return;
  const running = startJob();
  const { current, stillCurrent } = running;
  try {
    if (!modelReady) {
      show("download", 0);
      const stopProgress = bridge.onProgress((progress) => stillCurrent() && show("download", progress.fraction));
      const downloaded = await bridge.download().finally(stopProgress);
      if (!stillCurrent()) return;
      if (!downloaded.ok) throw downloaded.canceled ? null : new AppError(downloaded.error);
      modelReady = true;
    }

    show("decode", 0);
    const port = nextPort();
    const started = await bridge.start();
    if (!stillCurrent()) return;
    if (!started.ok) throw new AppError(started.error);
    const result = await runWorker(
      running,
      port.then(
        (received) =>
          /** @type {[object, Transferable[]]} */ ([{ type: "separate", media, port: received }, [received]]),
      ),
      (message) => new AppError(`The stems couldn't be separated: ${message}`),
      async (stems) => {
        preparing = 0; // their copies for saving come next
        if (!(await takeStems(stems, stillCurrent))) return;
        markNew();
        notify("The stems are ready");
      },
    );
    if (!stillCurrent()) return;
    // Their copies for saving, made by a few workers at once while they play.
    const { sampleRate, stems } = result.toEncode;
    const encoded = await inWorkers(running, Object.entries(stems), {
      message: (share) => [
        { type: "encode", stems: share, sampleRate },
        Object.values(share).flatMap((stem) => stem.channels.map((channel) => channel.buffer)),
      ],
      failure: (message) => new AppError(`The stems couldn't be prepared for saving: ${message}`),
      onProgress: (_stage, fraction) => ((preparing = fraction), render()),
    });
    if (stillCurrent()) takeAudio({ audio: Object.assign({}, ...encoded.map((done) => done.audio)) });
  } catch (error) {
    if (job !== current) return; // cancelled or replaced: nothing to report
    for (const stop of current.stops) stop(); // any other workers too
    failJob(error, "The stems couldn't be separated");
  }
}

// How many workers encode or decode stems at once: a few, at most half the
// cores, so playback keeps its share of the CPU.
const workerCount = () =>
  Math.max(1, Math.min(CONFIG.stems.workers, Math.floor((navigator.hardwareConcurrency || 2) / 2)));

/**
 * Runs a few workers at once (runWorker), each on a share of `entries`
 * ([id, value] pairs, dealt out in turn): `message(share)` is what each is
 * sent, and what it transfers. Their progress goes to `onProgress` as one,
 * the average; resolves to each worker's `done`.
 * @param {{ current: { stops: Set<() => void> }, stillCurrent: () => boolean }} running
 * @param {[string, any][]} entries
 * @param {{
 *   message: (share: Record<string, any>) => [object, Transferable[]],
 *   failure: (error: string) => AppError,
 *   onProgress: (stage: string, fraction: number) => void,
 *   onStems?: (part: any) => Promise<unknown>,
 * }} options
 */
function inWorkers(running, entries, { message, failure, onProgress, onStems = async () => {} }) {
  const count = Math.min(workerCount(), entries.length);
  const progress = new Array(count).fill(0);
  return Promise.all(
    Array.from({ length: count }, (_, w) => {
      const share = Object.fromEntries(entries.filter((_, i) => i % count === w));
      return runWorker(running, Promise.resolve(message(share)), failure, onStems, (stage, fraction) => {
        progress[w] = fraction;
        onProgress(stage, progress.reduce((sum, value) => sum + value, 0) / count);
      });
    }),
  );
}

/**
 * A project's stems, back in the player and the mixer (project.js): their
 * Opus bytes fetched from the project (`urls`), decoded by a few workers
 * at once, each a share of the stems; the player gets them all together.
 * @param {{ sampleRate: number, length: number, urls: Record<string, string>, mix: Record<string, any> }} saved
 */
export async function loadStems({ sampleRate, length, urls, mix: savedMix }) {
  cancel();
  const running = startJob();
  const { current, stillCurrent } = running;
  mix = savedMix;
  try {
    show("load", 0);
    const fetched = await Promise.all(
      Object.entries(urls).map(async ([id, url]) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`the ${id} stem can't be read (${response.status})`);
        return /** @type {[string, Uint8Array]} */ ([id, new Uint8Array(await response.arrayBuffer())]);
      }),
    );
    if (!stillCurrent()) return;
    const decoded = { sampleRate, length, stems: {} };
    const results = await inWorkers(running, fetched, {
      message: (share) => [{ type: "load", audio: share, sampleRate, length }, []],
      failure: (message) => new AppError(`The project's stems couldn't be brought back: ${message}`),
      onProgress: show,
      onStems: async (part) => Object.assign(decoded.stems, part.stems),
    });
    if (!stillCurrent()) return;
    if (!(await takeStems(decoded, stillCurrent))) return;
    takeAudio({ audio: Object.assign({}, ...results.map((result) => result.audio)) });
  } catch (error) {
    if (job !== current) return;
    for (const stop of current.stops) stop(); // the other workers too
    failJob(error, "The project's stems couldn't be brought back");
  }
}

function cancel() {
  const stopping = job;
  if (!stopping) return;
  job = null;
  stopping.cancelled = true;
  for (const stop of stopping.stops) stop(); // each worker ends with its wait
  bridge?.cancel();
  preparing = null;
  releaseWaiters();
  show(found ? "ready" : "idle", 0);
}

/* ---------- The mix ---------- */

// The player's gains from the mix. Every stem at full volume and centred:
// the song itself (the stems' gains 1, the song's 1: the player leaves it
// as it is); otherwise the stems alone (the song's 0), each through its
// 2×2 mix (its gain and pan: mix.js).
function applyMix() {
  if (!found) return;
  const mixes = stemMixes(CONFIG.stems.list, mix);
  const whole = isUnchanged(mixes);
  player.engine.setStemGains(
    found.ids.map((id) => (whole ? 1 : mixes[id])),
    whole ? 1 : 0,
  );
}

/** @param {string} id @param {Partial<import("./mix.js").StemSetting>} change */
function changeMix(id, change) {
  mix = { ...mix, [id]: { ...mix[id], ...change } };
  applyMix();
  render();
}

// Every folded stem back in the mixer, with the settings it had.
function unfoldAll() {
  mix = Object.fromEntries(Object.entries(mix).map(([id, setting]) => [id, { ...setting, folded: false }]));
  applyMix();
  render();
}

// Back to full volume and centred, nothing soloed or muted; what's folded
// into Other stays folded (Show brings it back).
function resetMix() {
  const fresh = defaultMix(CONFIG.stems.list);
  mix = Object.fromEntries(Object.entries(fresh).map(([id, setting]) => [id, { ...setting, folded: mix[id].folded }]));
  applyMix();
  render();
}

/* ---------- The section ---------- */

const percent = (value) => `${Math.floor(value * 100)} %`;
const megabytes = (bytes) => `${Math.round(bytes / 1e6)} MB`;

function show(nextStage, nextFraction) {
  stage = nextStage;
  fraction = nextFraction;
  render();
}

function render() {
  if (!ui) return;
  ui.section.hidden = !media;
  const busy = ["download", "decode", "separate", "load"].includes(stage);
  ui.action.hidden = busy || stage === "ready";
  ui.busy.hidden = !busy;
  ui.mixer.hidden = stage !== "ready";
  ui.reset.hidden = stage !== "ready";
  if (stage === "ready") ui.mixerRows.render(mix);
  ui.action.textContent = modelReady
    ? "Separate the stems"
    : `Separate the stems (${megabytes(modelBytes)} download, once)`;
  ui.action.title =
    "Split the song into vocals, drums, bass, guitar, piano and the rest. It runs in the background, " +
    "about as long as the song plays.";
  // Before the model is downloaded: what it is, and its licence (see
  // THIRD_PARTY_NOTICES.md).
  ui.note.hidden = modelReady || stage !== "idle";
  const label = {
    download: `Downloading the stem model ${percent(fraction)}`,
    decode: `Reading the song ${percent(fraction)}`,
    separate: `Separating ${percent(fraction)}`,
    load: `Loading the stems ${percent(fraction)}`,
  }[stage];
  if (label) ui.status.textContent = label;
  // New stems play while their copies for saving are made.
  ui.preparing.hidden = stage !== "ready" || preparing === null;
  ui.preparing.textContent = `Preparing them for saving ${percent(preparing ?? 0)}`;
}

function build(section) {
  const action = element("button", { type: "button", className: "stems-action" });
  const status = element("span", { className: "stems-status" });
  const stopButton = element("button", { type: "button", className: "small", textContent: "Cancel" });
  const busy = element("div", { className: "stems-busy" }, status, stopButton);
  const preparing = element("p", { className: "stems-note stems-preparing" });
  const note = element("p", {
    className: "stems-note",
    textContent:
      "The stem model is Demucs, by Meta. It isn't part of EarBee: its licence is unclear, " +
      "likely free for non-commercial use only (CC BY-NC).",
  });
  const reset = element("button", {
    type: "button",
    className: "icon-button small",
    title: "All stems back to full volume and centred, none soloed or muted",
    ariaLabel: "Reset the stems",
    innerHTML: '<svg class="icon" aria-hidden="true"><use href="#i-reset" /></svg>',
  });
  const mixer = element("div", { className: "stems-mixer" });
  const mixerRows = buildMixer(mixer, {
    list: CONFIG.stems.list,
    range: CONFIG.stems.volume,
    panRange: CONFIG.stems.pan,
    onChange: changeMix,
    onUnfoldAll: unfoldAll,
  });
  // A part of the Mixer (index.html): its own small heading, the reset beside it.
  section.append(
    element("div", { className: "stems-head" }, element("h3", { textContent: "Stems" }), reset),
    action,
    note,
    busy,
    mixer,
    preparing,
  );
  onClick(action, separate);
  onClick(stopButton, cancel);
  onClick(reset, resetMix);
  return { section, action, note, busy, status, mixer, mixerRows, preparing, reset };
}

/* ---------- Wiring ---------- */

export function bindStems() {
  const section = $("stemsSection");
  if (!CONFIG.stems.enabled || !bridge) {
    section?.remove();
    return;
  }
  ui = build(section);
  render();
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data !== "earbee:stems-port") return;
    const waiter = portWaiter;
    portWaiter = null;
    if (waiter) waiter(event.ports[0]);
    else event.ports[0]?.close(); // nobody's waiting: the process exits
  });
  bridge
    .model()
    .then((model) => {
      modelReady = model.ready;
      modelBytes = model.bytes;
      render();
    })
    .catch((error) => console.warn("The stem model's status is unknown:", error));
}

/** @param {import("../../core/media.js").Media | null} next */
export function resetStems(next) {
  cancel();
  media = next;
  // The player dropped them with the old track; this is for a load that
  // was on its way.
  if (found) player.engine.dropStems();
  found = null;
  audio = null;
  mix = defaultMix(CONFIG.stems.list);
  show("idle", 0);
}

/** What was found for the open song (else null). @returns {Stems | null} */
export const stemsFound = () => found;

/**
 * What a project saves (project.js): the stems' Opus bytes, the mix, and
 * `revision`, which changes whenever the stems do. Null without stems.
 */
export const stemsToSave = () => found && audio && { ...found, audio, mix, revision };

/**
 * Resolves once new stems' copies for saving are made (at once if there's
 * nothing to wait for), so a save started meanwhile keeps the stems.
 */
export const whenPrepared = () =>
  found && !audio && preparing !== null
    ? new Promise((resolve) => preparedWaiters.push(() => resolve(undefined)))
    : Promise.resolve();
// While a project's stems load, their mix already counts: the project was
// saved with it.
export const stemsRevision = () => ({ revision, mix: found || stage === "load" ? mix : null });
