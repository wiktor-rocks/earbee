/* =====================================================================
 * STEMS
 * The open song split into its instruments (vocals, drums, bass, guitar,
 * piano, and the rest), by the stem model in the main process
 * (electron/stems/), on demand: the Stems section's two buttons, the loop
 * alone or the whole song.
 *
 *   0. First, whether it fits in memory (memory.js): if this computer
 *      hasn't enough for the song's stems, it says so and nothing starts.
 *      The loop alone needs little, however long the song: its stems are
 *      held only in a window around it (CONFIG.stems.window), and the stem
 *      process keeps only the song around it.
 *   1. The first time, the model is downloaded (116 MB, once; the main
 *      process checks it).
 *   2. A worker (worker.js) decodes the song again at 44.1 kHz and streams
 *      it to the stem process, which separates it one 7.8 s segment at a
 *      time, at low priority (about as long as the song plays): the loop
 *      first (or the part around the playhead), then the rest, nearest the
 *      loop first. Moving the loop meanwhile moves what's next.
 *   3. Each piece comes back to the worker, which turns it into the track's
 *      rate in 16 bits, then here, and on to the player (audio/engine.js
 *      writeStems): the stems play through the same stretcher as the track,
 *      mixed into its input, so they keep in step at any speed, pitch or
 *      loop. Where they aren't separated yet, the song plays as it is
 *      (spans.js), and a strip on the waveform shows what's done.
 *   4. Once the loop's part is done the mixer shows ("The loop's stems are
 *      ready") while the rest goes on in the background; Stop ends it,
 *      keeping what's done, and "Separate the rest" carries on later. The
 *      loop alone ends there. Separating another loop alone then replaces
 *      it; over the whole song's stems (stopped part way), it adds to them;
 *      the whole song after the loop alone widens the window to all of it
 *      and carries on.
 *   5. When it ends, a few workers encode a copy of each stem as Opus for
 *      the project ("Preparing them for saving"). They're an unsaved change
 *      as soon as they play; a save started before their copies are made
 *      waits for them (whenPrepared), and a save while separating takes the
 *      stems so far.
 * Opening another file stops it: the worker ends, and the main process
 * stops the stem process.
 *
 * A project's stems are brought back the same way, if they fit in memory;
 * if not, they're kept as they are in the project (`held`), unplayed, so
 * saving it again keeps them.
 *
 * The section is then a mixer (dock.js): each stem's volume, solo and
 * mute, turned into gains (mix.js) for the player. With every stem at full
 * volume it plays the song itself, exactly; any other mix is the sum of
 * the six stems (so a muted one is gone, with nothing of it left).
 *
 * Self-contained: this folder, its stems.css, electron/stems/, and the
 * lines marked "Stems (" (app.js, open-file.js, index.html, config.js,
 * main.js, preload.js, waveform.js). With CONFIG.stems.enabled off, the
 * section is removed and nothing else happens.
 *
 *   bindStems()        builds the section (once, at startup)
 *   resetStems(media, track)
 *                      a new file is open ({ duration, sampleRate }): what
 *                      was found is forgotten
 *   stemsFound()       what was found for the open song (else null)
 *   stemsToSave(), stemsRevision(), whenPrepared(), loadStems(saved)
 *                      for the project (project.js)
 * ===================================================================== */

import { CONFIG } from "../../config.js";
import { player } from "../../context.js";
import { AppError } from "../../core/errors.js";
import { formatMemory } from "../../core/format.js";
import { $, element, onClick, reportError } from "../../ui/dom.js";
import { notify } from "../../ui/toast.js";
import { buildMixer } from "./dock.js";
import { loadingBytes, memoryLimit, partBytes, separationBytes } from "./memory.js";
import { defaultMix, isUnchanged, stemMixes } from "./mix.js";
import { coveredLength, covers, coversAll } from "./spans.js";

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

// The stems' samples are 16 bits × this (worker.js).
const SCALE = CONFIG.stems.headroom / 32767;
const IDS = CONFIG.stems.list.map(({ id }) => id); // the player's order

/**
 * What was found for the open song (the samples themselves went to the
 * player): the stems' ids in the player's order, at `sampleRate`, for a
 * track `length` samples long, holding `span` samples from its sample
 * `start` (0 and `length` for the whole song; less for the loop alone),
 * each one's loudness (once all of it is done), and the spans of the
 * track's samples separated so far (spans.js).
 * @typedef {{
 *   sampleRate: number, length: number, start: number, span: number, ids: string[],
 *   levels: Record<string, number>, covered: import("./spans.js").Spans,
 * }} Stems
 */

/** @typedef {Record<string, Int16Array[]>} Samples each stem's left and right (worker.js) */

/** @type {import("../../core/media.js").Media | null} */
let media = null; // the open song's, to read again
/** @type {{ duration: number, sampleRate: number } | null} */
let track = null; // its length and rate, for the memory it needs
/** @type {Stems | null} */
let found = null;
// The page's copy of the stems' samples, to carry on separating from and to
// encode: null while a worker has it (or before there are stems).
/** @type {Samples | null} */
let copies = null;
/** @type {Record<string, Uint8Array> | null} */
let audio = null; // each stem as Opus, for the project (opus.js)
/** @type {import("./spans.js").Spans} */
let audioCovered = []; // the spans `audio` holds
let revision = 0; // counts the stems separated (not those a project brings back), for unsaved changes
let preparedRevision = 0; // the revision `audio` was made at
let modelBytes = 0;
let modelReady = false;
// What's going on: "idle", "download", "decode", "separate" (the first
// part), "rest" (the rest, while the mixer shows), "load" (from a
// project) or "ready".
let stage = "idle";
let fraction = 0;
let fromLoop = false; // the first part is the loop (else around the playhead)
// While the stems' copies for saving are made: how far (null: not encoding).
/** @type {number | null} */
let preparing = null;
// Each stem's volume, solo and mute (mix.js).
let mix = defaultMix(CONFIG.stems.list);
// The separation or load going on: `stops` end its workers' waits (cancel);
// `worker`, a separation's, to tell it where the loop moved, or to stop;
// `onlyPart`, the loop alone's (fixed to its part).
/** @type {{ cancelled: boolean, stops: Set<() => void>, worker?: Worker, onlyPart?: boolean } | null} */
let job = null;

// A project's stems that didn't fit in memory: as the project has them
// (their Opus bytes), unplayed, for saving it again.
/** @type {(Omit<Stems, "levels"> & { audio: Record<string, Uint8Array>, mix: typeof mix }) | null} */
let held = null;

let ui = null; // the section's parts, once built

/* ---------- Memory ---------- */

// The system's memory, from the main process: { available, total }, each
// null where unknown (or outside Electron).
async function systemMemory() {
  const ask = async (/** @type {string} */ name) => {
    try {
      return (await /** @type {any} */ (window).earbee?.[name]?.()) ?? null;
    } catch {
      return null;
    }
  };
  const [available, total] = await Promise.all([ask("availableMemory"), ask("totalMemory")]);
  return { available, total };
}

// Why `needed` bytes don't fit, as the end of a message ("it needs …"), or
// null if they do (or that can't be told). `orLoop`: the loop alone would
// need less, so it says so.
async function shortOfMemory(needed, orLoop = false) {
  const memory = await systemMemory();
  const limit = memoryLimit(memory);
  if (!limit || needed <= limit.bytes) return null;
  const needs = `it needs about ${formatMemory(needed)} of memory`;
  return limit.of === "available"
    ? `${needs}, and ${formatMemory(memory.available)} is available. ` +
        (orLoop ? "Closing other programs, or separating the loop only, may help." : "Closing other programs may help.")
    : `${needs}, more than half of this computer's ${formatMemory(memory.total)}.` +
        (orLoop ? " Separating the loop only may help." : "");
}

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

const buffersOf = (/** @type {Samples} */ stems) =>
  Object.values(stems).flatMap((channels) => channels.map((channel) => channel.buffer));

/**
 * Runs a worker (worker.js) on `message` until it's done; its progress
 * shows meanwhile (`onProgress`, else show()), and its other messages go
 * to `onMessage` as they come. Rejects with `null` when the job is
 * cancelled. If the stem process stops early, `onStopped` hears it (else
 * the worker fails).
 * @param {{ current: { stops: Set<() => void> }, stillCurrent: () => boolean }} running
 * @param {{
 *   message: Promise<[object, Transferable[]]>,
 *   failure: (error: string) => AppError,
 *   onMessage?: (data: any) => Promise<unknown> | void,
 *   onProgress?: (stage: string, fraction: number, data: any) => void,
 *   onStopped?: (error: AppError) => void,
 *   onWorker?: (worker: Worker) => void,
 * }} options
 */
async function runWorker(
  { current, stillCurrent },
  { message, failure, onMessage, onProgress = show, onStopped, onWorker },
) {
  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  onWorker?.(worker);
  let stopStopped = () => {};
  let stop = () => {};
  return new Promise((resolve, reject) => {
    stop = () => reject(null);
    current.stops.add(stop);
    if (bridge) {
      stopStopped = bridge.onStopped((stopped) => {
        const error = new AppError(stopped.error);
        if (onStopped) onStopped(error);
        else reject(error);
      });
    }
    worker.addEventListener("message", ({ data }) => {
      if (data.type === "progress") stillCurrent() && onProgress(data.stage, data.fraction, data);
      else if (data.type === "done") resolve(data);
      else if (data.type === "error") reject(failure(data.message));
      else Promise.resolve(onMessage?.(data)).catch(reject);
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

// What to separate first, in seconds: the loop, or the part around the playhead.
function firstPart() {
  const loop = player.transport.loop;
  fromLoop = Boolean(loop);
  if (loop) return { from: loop.start, to: loop.end };
  const at = player.transport.position;
  const { before, after } = CONFIG.stems.firstPart;
  return { from: Math.max(0, at - before), to: at + after };
}

// The strip on the waveform: what's separated so far, while not all of it is.
function drawCovered() {
  const spans = found ?? pending;
  const partly = spans && !coversAll(spans.covered, spans.length);
  player.waveform?.setStemsCovered(
    partly ? spans.covered.map(([from, to]) => [from / spans.sampleRate, to / spans.sampleRate]) : null,
  );
}
// A separation's stems before its first part is done (found is set then).
/** @type {Stems | null} */
let pending = null;

// The stems found, to the player (in its order; the samples are
// transferred); then the mixer shows. Resolves false if the job ended
// meanwhile.
async function takeStems(result, covered, stillCurrent) {
  const ids = IDS.filter((id) => result.stems[id]);
  const { start = 0, span = result.length } = result;
  await player.engine.loadStems(
    ids.map((id) => result.stems[id]),
    covered,
    start,
  );
  if (!stillCurrent()) return false;
  const levels = Object.fromEntries(ids.map((id) => [id, result.stems[id].level]));
  found = { sampleRate: result.sampleRate, length: result.length, start, span, ids, levels, covered };
  applyMix();
  drawCovered();
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

// The job failed: the stems that already play stay; before that, back to
// the button.
function failJob(error, what) {
  job = null;
  endSnapshot();
  pending = null;
  if (!found) {
    mix = defaultMix(CONFIG.stems.list);
    player.engine.dropStems();
  }
  drawCovered();
  show(found ? "ready" : "idle", 0);
  if (error) reportError(error instanceof AppError ? error : new AppError(`${what}: ${error.message ?? error}`, error));
}

// Whether the stems hold only a window of the track (the loop alone's).
const windowed = (/** @type {Stems | null} */ stems) => Boolean(stems) && stems.span < stems.length;

// Forgets the stems found (for the loop alone's next part): the player
// drops them, their copies go; the mix stays.
function dropFound() {
  preparationJob.cancelled = true;
  for (const stop of preparationJob.stops) stop();
  preparation = null;
  preparing = null;
  player.engine.dropStems();
  found = null;
  copies = null;
  audio = null;
  audioCovered = [];
}

// The page's copy of a window's stems, and the player's, widened to the
// whole track (the window in its place), so the whole song can carry on
// from them.
async function widen() {
  const stems = /** @type {Stems} */ (found);
  const full = /** @type {Samples} */ (
    Object.fromEntries(
      Object.entries(/** @type {Samples} */ (copies)).map(([id, channels]) => [
        id,
        channels.map((channel) => {
          const whole = new Int16Array(stems.length);
          whole.set(channel, stems.start);
          return whole;
        }),
      ]),
    )
  );
  await player.engine.loadStems(
    stems.ids.map((id) => ({ scale: SCALE, channels: full[id].map((channel) => channel.slice()) })),
    stems.covered,
  );
  copies = full;
  stems.start = 0;
  stems.span = stems.length;
  applyMix();
}

/**
 * Separates the whole song (the loop first, then the rest), or with
 * `onlyLoop`, the loop alone (or the part around the playhead).
 * @param {{ onlyLoop?: boolean }} [options]
 */
async function separate({ onlyLoop = false } = {}) {
  if (!bridge || !media || job) return;
  const running = startJob();
  const { current, stillCurrent } = running;
  const part = onlyLoop ? firstPart() : null;
  current.onlyPart = Boolean(part);
  // The loop alone over the loop alone's stems replaces them (below); the
  // whole song over them widens them first.
  const replacing = Boolean(part) && windowed(found);
  const widening = !part && windowed(found);
  // "Separate the rest", or the loop alone over the whole song's: an earlier run's stems play already.
  const carryOn = Boolean(found) && !replacing;
  /** @type {AppError | null} */
  let stoppedEarly = null;
  try {
    // Before anything is downloaded or started.
    if (track) {
      const { duration, sampleRate } = track;
      const needed = part
        ? partBytes({ seconds: part.to - part.from + 2 * CONFIG.stems.window, sampleRate })
        : separationBytes({ seconds: duration, sampleRate, carryOn: carryOn && !widening });
      const short = await shortOfMemory(needed, !part);
      if (!stillCurrent()) return;
      if (short) {
        const what = part ? (fromLoop ? "the loop" : "the part around the playhead") : `“${media.name}”`;
        throw new AppError(`Not enough memory to separate the stems of ${what}: ${short}`);
      }
    }
    if (replacing) {
      dropFound();
      drawCovered();
    }
    if (!modelReady) {
      show("download", 0);
      const stopProgress = bridge.onProgress((progress) => stillCurrent() && show("download", progress.fraction));
      const downloaded = await bridge.download().finally(stopProgress);
      if (!stillCurrent()) return;
      if (!downloaded.ok) throw downloaded.canceled ? null : new AppError(downloaded.error);
      modelReady = true;
    }

    show("decode", 0);
    // Their copy is the worker's while it runs (made for saving first, if it's on its way).
    await preparation;
    if (!stillCurrent()) return;
    if (widening && copies) await widen();
    if (!stillCurrent()) return;
    const earlier = carryOn ? copies : null;
    if (carryOn && !earlier) throw new AppError("The stems separated so far can't be added to.");
    copies = null;
    const port = nextPort();
    const started = await bridge.start();
    if (!stillCurrent()) {
      if (earlier) copies = earlier;
      return;
    }
    if (!started.ok) {
      if (earlier) copies = earlier;
      throw new AppError(started.error);
    }

    let loaded = Promise.resolve();
    const result = await runWorker(running, {
      message: port.then((received) => [
        {
          type: "separate",
          media,
          port: received,
          want: part ?? firstPart(),
          part,
          covered: found?.covered ?? [],
          stems: earlier,
        },
        [received, ...(earlier ? buffersOf(earlier) : [])],
      ]),
      failure: (message) => new AppError(`The stems couldn't be separated: ${message}`),
      onWorker: (worker) => (current.worker = worker),
      // The process stopped early: the worker hands over what's done.
      onStopped: (error) => {
        stoppedEarly = error;
        current.worker?.postMessage({ type: "stop" });
      },
      onProgress: (_stage, value, data) => {
        if (data.stage === "decode") return show("decode", value);
        // The first part is done: the mixer shows, the rest goes on.
        if (data.wanted && !found && pending) {
          found = pending;
          pending = null;
          applyMix();
          markNew();
          notify(fromLoop ? "The loop's stems are ready" : "The first stems are ready");
        }
        // (The loop alone ends with its part.)
        if (found && !current.onlyPart) show("rest", value);
        else show("separate", data.part ?? 0);
      },
      onMessage: (data) => {
        if (!stillCurrent()) return;
        if (data.type === "begin" && !carryOn) {
          // Silent stems to begin with (over the samples they'll hold); the pieces fill them in.
          const empty = () => new Int16Array(data.span);
          loaded = player.engine.loadStems(
            IDS.map(() => ({ scale: SCALE, channels: [empty(), empty()] })),
            [],
            data.start,
          );
          const { sampleRate, length, start, span } = data;
          pending = { sampleRate, length, start, span, ids: IDS, levels: {}, covered: [] };
        } else if (data.type === "piece") {
          const stems = found ?? pending;
          if (!stems) return;
          stems.covered = data.covered;
          loaded = loaded.then(() =>
            player.engine.writeStems(
              data.from,
              IDS.map((id) => data.stems[id]),
              data.covered,
            ),
          );
          drawCovered();
        } else if (data.type === "snapshot") snapshotWaiter?.(data);
      },
    });
    if (!stillCurrent()) return;
    // Ended (all done, Stop, or the process failed): the stems so far are the page's again.
    endSnapshot();
    copies = result.stems;
    found ??= pending;
    pending = null;
    if (!found || coveredLength(result.covered) === 0)
      throw stoppedEarly ?? new AppError(result.error ?? "nothing was separated");
    found.covered = result.covered;
    if (coversAll(result.covered, found.length)) found.levels = result.levels;
    job = null;
    applyMix();
    drawCovered();
    markNew();
    show("ready", 1);
    if (result.error || stoppedEarly) {
      reportError(stoppedEarly ?? new AppError(`Separating the stems stopped: ${result.error}`));
    }
    prepare();
  } catch (error) {
    if (job !== current) return; // cancelled or replaced: nothing to report
    for (const stop of current.stops) stop(); // any other workers too
    failJob(error, "The stems couldn't be separated");
  }
}

// Stop: what's separated stays (the worker hands it over and the separation
// ends as if done). Before the first part is done, it's Cancel.
function stopSeparating() {
  if (!job?.worker || !found || !["rest", "decode"].includes(stage)) return cancel();
  bridge?.cancel();
  job.worker.postMessage({ type: "stop" });
}

// While separating: a copy of the stems so far, from the worker.
/** @type {((data: { stems: Samples, covered: import("./spans.js").Spans } | null) => void) | null} */
let snapshotWaiter = null;
// The separation ended before its snapshot came: none (the page has the stems again).
const endSnapshot = () => snapshotWaiter?.(null);
function snapshot() {
  return new Promise((resolve) => {
    snapshotWaiter = (data) => {
      snapshotWaiter = null;
      resolve(data);
    };
    job?.worker?.postMessage({ type: "snapshot" });
  });
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
      return runWorker(running, {
        message: Promise.resolve(message(share)),
        failure,
        onMessage: (data) => (data.type === "stems" ? onStems(data) : undefined),
        onProgress: (stage, fraction) => {
          progress[w] = fraction;
          onProgress(stage, progress.reduce((sum, value) => sum + value, 0) / count);
        },
      });
    }),
  );
}

/* ---------- Copies for saving ---------- */

// The Opus copies being made (prepare), or null.
/** @type {Promise<void> | null} */
let preparation = null;
// Its workers' waits, ended when the song changes.
let preparationJob = { cancelled: false, stops: new Set() };

// Whether the Opus copies are older than the stems.
const stale = () =>
  Boolean(found) &&
  (preparedRevision !== revision || coveredLength(audioCovered) !== coveredLength(found?.covered ?? []));

// Makes the stems' Opus copies for the project, by a few workers at once,
// while they play: from the page's copy, or while separating, from a copy
// of the stems so far. Again if they changed meanwhile.
function prepare() {
  if (preparation || !stale()) return preparation ?? Promise.resolve();
  const current = { cancelled: false, stops: new Set() };
  preparationJob = current;
  const forSong = media;
  const running = { current, stillCurrent: () => !current.cancelled && media === forSong };
  preparation = (async () => {
    while (running.stillCurrent() && stale()) {
      const target = revision;
      const separating = Boolean(job?.worker);
      // The page's copy goes to the workers and comes back; a snapshot is theirs.
      const source = separating ? await snapshot() : copies && { stems: copies, covered: found.covered };
      if (!running.stillCurrent()) return;
      if (!source) {
        if (separating) continue; // it ended meanwhile: from the page's copy
        return;
      }
      if (!separating) copies = null;
      preparing = 0;
      render();
      const sampleRate = found.sampleRate;
      try {
        const encoded = await inWorkers(running, Object.entries(source.stems), {
          message: (share) => [{ type: "encode", stems: share, sampleRate }, buffersOf(share)],
          failure: (message) => new AppError(`The stems couldn't be prepared for saving: ${message}`),
          onProgress: (_stage, value) => ((preparing = value), render()),
        });
        if (!separating) copies = Object.assign({}, ...encoded.map((done) => done.stems));
        if (!running.stillCurrent()) return;
        audio = Object.assign({}, ...encoded.map((done) => done.audio));
        audioCovered = source.covered;
        preparedRevision = target;
      } catch (error) {
        if (error && running.stillCurrent()) reportError(error);
        return;
      }
    }
  })().finally(() => {
    if (preparationJob === current) {
      preparation = null;
      preparing = null;
      render();
    }
  });
  return preparation;
}

/**
 * A project's stems, back in the player and the mixer (project.js): their
 * Opus bytes fetched from the project (`urls`), decoded by a few workers
 * at once, each a share of the stems; the player gets them all together.
 * `covered`: the parts separated, if not all of it; `start` and `span`,
 * the samples they hold (the loop alone's window), if not all of them. If
 * they wouldn't fit in memory, only their bytes are kept (`held`), and it
 * says so.
 * @param {{
 *   sampleRate: number, length: number, start?: number, span?: number,
 *   urls: Record<string, string>, mix: Record<string, any>, covered: import("./spans.js").Spans,
 * }} saved
 */
export async function loadStems({
  sampleRate,
  length,
  start = 0,
  span = length - start,
  urls,
  mix: savedMix,
  covered,
}) {
  cancel();
  const running = startJob();
  const { current, stillCurrent } = running;
  mix = savedMix;
  try {
    show("load", 0);
    const short = await shortOfMemory(loadingBytes({ seconds: span / sampleRate, sampleRate }));
    if (!stillCurrent()) return;
    const fetched = await Promise.all(
      Object.entries(urls).map(async ([id, url]) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`the ${id} stem can't be read (${response.status})`);
        return /** @type {[string, Uint8Array]} */ ([id, new Uint8Array(await response.arrayBuffer())]);
      }),
    );
    if (!stillCurrent()) return;
    if (short) {
      job = null;
      held = { sampleRate, length, start, span, ids: IDS, covered, audio: Object.fromEntries(fetched), mix: savedMix };
      show("idle", 0);
      reportError(new AppError(`The project's stems weren't brought back: ${short}`));
      return;
    }
    const decoded = { sampleRate, length, start, span, stems: {} };
    const results = await inWorkers(running, fetched, {
      message: (share) => [{ type: "load", audio: share, sampleRate, length: span }, []],
      failure: (message) => new AppError(`The project's stems couldn't be brought back: ${message}`),
      onProgress: show,
      onStems: async (part) => Object.assign(decoded.stems, part.stems),
    });
    if (!stillCurrent()) return;
    if (!(await takeStems(decoded, covered, stillCurrent))) return;
    job = null;
    copies = Object.assign({}, ...results.map((result) => result.stems));
    audio = Object.assign({}, ...results.map((result) => result.audio));
    audioCovered = covered;
    preparedRevision = revision;
    render();
  } catch (error) {
    if (job !== current) return;
    for (const stop of current.stops) stop(); // the other workers too
    failJob(error, "The project's stems couldn't be brought back");
  }
}

// Ends the job at once: its workers stop, and so does the stem process. A
// separation's stems so far are lost: for a new song (or a project's
// stems), or before its first part is done.
function cancel() {
  const stopping = job;
  if (!stopping) return;
  job = null;
  stopping.cancelled = true;
  for (const stop of stopping.stops) stop(); // each worker ends with its wait
  bridge?.cancel();
  endSnapshot();
  if (pending && !found) player.engine.dropStems();
  pending = null;
  drawCovered();
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
  const busy = ["download", "decode", "separate", "rest", "load"].includes(stage);
  const partly = Boolean(found) && !coversAll(found.covered, found.length);
  const all = Boolean(found) && !partly;
  // The loop alone: offered unless the loop is separated already (around
  // the playhead, always: it moves).
  const loop = player.transport.loop;
  const loopDone =
    Boolean(found && loop) &&
    covers(found.covered, Math.ceil(loop.start * found.sampleRate), Math.floor(loop.end * found.sampleRate));
  ui.loopAction.hidden = busy || all || loopDone || Boolean(held);
  ui.action.hidden = busy || all || Boolean(held);
  ui.held.hidden = !held || busy;
  ui.busy.hidden = !busy;
  ui.stop.textContent = stage === "rest" ? "Stop" : "Cancel";
  ui.stop.title = stage === "rest" ? "Stop separating; what's done stays" : "";
  ui.mixer.hidden = !found;
  ui.reset.hidden = !found;
  if (found) ui.mixerRows.render(mix);
  // Short: what the model is and its licence are on EarBee/models and in
  // THIRD_PARTY_NOTICES.md; the first time's download size, in the tooltip.
  const rest = partly && !windowed(found);
  const download = modelReady ? "" : ` The first time, the stem model is downloaded (${megabytes(modelBytes)}).`;
  ui.action.textContent = rest ? "Separate the rest" : "Separate the whole song";
  ui.action.title =
    (rest
      ? "Separate the rest of the song, in the background."
      : "Split the whole song into vocals, drums, bass, guitar, piano and the rest, the loop first " +
        "(or from the playhead), then the rest in the background.") + download;
  ui.loopAction.textContent = loop ? "Separate the loop" : "Separate from the playhead";
  ui.loopAction.title =
    (loop
      ? "Split only the loop into its stems: quick, and little memory however long the song."
      : "Split only the part around the playhead into its stems: quick, and little memory however long the song.") +
    (windowed(found) ? " The part separated before goes." : "") +
    download;
  const label = {
    download: `Downloading the stem model ${percent(fraction)}`,
    decode: `Reading the song ${percent(fraction)}`,
    separate: `${fromLoop ? "Separating the loop" : "Separating from the playhead"} ${percent(fraction)}`,
    rest: `Separating the rest ${percent(fraction)}`,
    load: `Loading the stems ${percent(fraction)}`,
  }[stage];
  if (label) ui.status.textContent = label;
  // New stems play while their copies for saving are made.
  ui.preparing.hidden = !found || busy || preparing === null;
  ui.preparing.textContent = `Preparing them for saving ${percent(preparing ?? 0)}`;
}

function build(section) {
  const loopAction = element("button", { type: "button", className: "stems-action stems-loop" });
  const action = element("button", { type: "button", className: "stems-action stems-whole" });
  const status = element("span", { className: "stems-status" });
  const stop = element("button", { type: "button", className: "small", textContent: "Cancel" });
  const busy = element("div", { className: "stems-busy" }, status, stop);
  const preparing = element("p", { className: "stems-note stems-preparing" });
  const heldNote = element("p", {
    className: "stems-note stems-held",
    textContent: "This project's stems weren't loaded: not enough memory. Saving keeps them.",
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
  // A part of the Mixer (index.html): its own small heading, the reset
  // beside it. While the rest is separated, the mixer shows above its
  // progress. The two buttons: the loop alone, the whole song.
  section.append(
    element("div", { className: "stems-head" }, element("h3", { textContent: "Stems" }), reset),
    mixer,
    loopAction,
    action,
    busy,
    preparing,
    heldNote,
  );
  onClick(loopAction, () => separate({ onlyLoop: true }));
  onClick(action, () => separate());
  onClick(stop, stopSeparating);
  onClick(reset, resetMix);
  return { section, loopAction, action, busy, status, stop, mixer, mixerRows, preparing, held: heldNote, reset };
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
  // The loop moved while separating the whole song: that part next (the
  // loop alone stays with its part). And the loop button follows it.
  player.transport.on("loop", (loop) => {
    if (loop && job?.worker && !job.onlyPart) job.worker.postMessage({ type: "want", from: loop.start, to: loop.end });
    render();
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

/**
 * @param {import("../../core/media.js").Media | null} next
 * @param {{ duration: number, sampleRate: number } | null} [nextTrack] its length and rate
 */
export function resetStems(next, nextTrack = null) {
  cancel();
  preparationJob.cancelled = true;
  for (const stop of preparationJob.stops) stop();
  preparation = null;
  preparing = null;
  media = next;
  track = nextTrack;
  held = null;
  // The player dropped them with the old track; this is for a load that
  // was on its way.
  if (found) player.engine.dropStems();
  found = null;
  copies = null;
  audio = null;
  audioCovered = [];
  mix = defaultMix(CONFIG.stems.list);
  drawCovered();
  show("idle", 0);
}

/** What was found for the open song (else null). @returns {Stems | null} */
export const stemsFound = () => found;

/**
 * What a project saves (project.js): the stems' Opus bytes and the spans
 * they cover, the mix, and `revision`, which changes whenever the stems
 * do; or a project's stems that didn't fit in memory, as they came. Null
 * without stems.
 */
export const stemsToSave = () =>
  (found && audio && { ...found, covered: audioCovered, audio, mix, revision }) || (held && { ...held, revision });

/**
 * Resolves once the stems' copies for saving are made (at once if there's
 * nothing to wait for), so a save started meanwhile keeps the stems; while
 * separating, the stems so far.
 */
export const whenPrepared = () => prepare();
// While a project's stems load, their mix already counts: the project was
// saved with it.
export const stemsRevision = () => ({ revision, mix: found || held || stage === "load" ? mix : null });
