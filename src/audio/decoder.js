import { CONFIG } from "../config.js";
import { readWhole } from "../core/files.js";
import { findJoin, joinParts, splitFrames } from "../core/parts.js";
import { downsampleLevels } from "../core/peaks.js";

/* =====================================================================
 * DECODER
 * The audio of a file at its own sample rate, plus the waveform levels (peak and RMS).
 * Normally decoded in chunks by decode-worker.js, a long track in parts
 * by several of them at once; formats it can't read fall back to
 * decodeAudioData on the whole file (the old way, fine for short files).
 *
 * decodeFile(media, { prepare, onProgress, signal, workers }):
 *   media          a File, or a download's { name, url } (core/files.js)
 *   prepare(info)  called once the track is known, before decoding:
 *                  info = { duration, sampleRate, channels }; returns
 *                  { peakFactor (samples per peak), workers (how many
 *                  parts) }, or throws to refuse the file (e.g. it won't
 *                  fit in memory)
 *   onProgress(f)  0…1 while decoding (not for the fallback)
 *   signal         aborting stops the decoding (rejects with AbortError)
 *   workers        overrides prepare's count (for the tests)
 * Resolves to { pieces, levels, sampleRate, duration }: `pieces` is the
 * track in order, as [piece][channel] Float32Arrays, never copied into one
 * array (that would need twice the memory for a moment); the engine plays
 * them one after the other.
 * Rejects with a DecodeFailure (kind: see decode-worker.js) when the file
 * can't be decoded, or with whatever prepare() threw.
 *
 * In parallel, each part but the first starts decoding a little early to
 * warm up, and decodes a little past its end; the parts are then joined
 * where their samples match (core/parts.js findJoin), because timestamps
 * aren't always sample-exact. If they don't match, the track is decoded
 * again in one part: slower, never wrong.
 * ===================================================================== */

export class DecodeFailure extends Error {
  /** @param {"cannot-decode" | "no-audio" | "out-of-memory" | "failed"} kind */
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/**
 * @typedef {import("../core/files.js").Media} Media
 * @typedef {{ duration: number, sampleRate: number, channels: number }} TrackInfo
 * @typedef {{ peakFactor: number, workers?: number }} DecodePlan
 * @typedef {object} DecodeOptions
 * @property {(info: TrackInfo) => DecodePlan | Promise<DecodePlan>} prepare
 * @property {(fraction: number) => void} [onProgress]
 * @property {AbortSignal} [signal]
 * @property {number} [workers]
 * @typedef {{ pieces: Float32Array[][], levels: import("../core/parts.js").Levels[], sampleRate: number, duration: number }} Decoded
 */

const aborted = () => new DOMException("Decoding was canceled.", "AbortError");

// One decode worker; open() and decode() resolve with its answer.
function startWorker(media, onWritten) {
  let worker;
  try {
    worker = new Worker(new URL("./decode-worker.js", import.meta.url), { type: "module" });
  } catch (error) {
    throw new DecodeFailure("cannot-decode", `no decode worker: ${error}`);
  }
  let pending = null;
  const settle = (outcome, value) => {
    const request = pending;
    pending = null;
    request?.[outcome](value);
  };

  // The worker script failed to load or crashed.
  worker.addEventListener("error", (event) => {
    event.preventDefault();
    settle("reject", new DecodeFailure("cannot-decode", `decode worker failed: ${event.message}`));
  });
  worker.addEventListener("message", ({ data }) => {
    if (data.type === "progress") onWritten(data.written);
    else if (data.type === "error") settle("reject", new DecodeFailure(data.kind, data.message));
    else settle("resolve", data);
  });

  const ask = (message) =>
    new Promise((resolve, reject) => {
      pending = { resolve, reject };
      worker.postMessage(message);
    });
  return {
    open: () => ask({ type: "open", media }),
    decode: (part) => ask({ type: "decode", ...part }),
    terminate: () => worker.terminate(),
  };
}

// Where each part ends (where the next one starts), or null if two parts
// don't join.
function findJoins(results, parts, sampleRate) {
  const { maxLag, joinWindow, joinTolerance } = CONFIG.audio.parallel;
  const options = { maxLag: Math.ceil(maxLag * sampleRate), window: joinWindow, tolerance: joinTolerance };
  const keep = [];
  let start = 0; // where the part before starts in the track
  for (let k = 1; k < results.length; k++) {
    // A part that got (almost) nothing: the track ended early.
    if (results[k].written < joinWindow) return null;
    const at = findJoin(results[k - 1].channels, results[k].channels, parts[k].from - start, options);
    if (at === null || at <= 0 || at > results[k - 1].written) return null;
    keep.push(at);
    start += at;
  }
  keep.push(results.at(-1).written);
  return keep;
}

/** @param {Media} media @param {DecodeOptions} options @returns {Promise<Decoded>} */
async function decodeInWorkers(media, options) {
  const { prepare, onProgress, signal } = options;
  const workers = [];
  const written = [];
  let report = () => {};
  const start = () => {
    const k = workers.length;
    const worker = startWorker(media, (frames) => {
      written[k] = frames;
      report();
    });
    workers.push(worker);
    return worker;
  };

  let onAbort;
  const abort = new Promise((_, reject) => (onAbort = () => reject(aborted())));
  abort.catch(() => {});
  signal?.addEventListener("abort", onAbort);
  /** @type {<T>(promise: Promise<T>) => Promise<T>} */
  const unlessAborted = (promise) => Promise.race([promise, abort]);

  try {
    if (signal?.aborted) throw aborted();
    const info = await unlessAborted(start().open());
    const plan = await unlessAborted(Promise.resolve(prepare(info)));
    const { sampleRate } = info;
    const total = Math.ceil(info.duration * sampleRate);
    const parts = splitFrames(total, options.workers ?? plan.workers ?? 1, plan.peakFactor);
    report = () => onProgress?.(Math.min(1, written.reduce((sum, frames) => sum + (frames ?? 0), 0) / total));

    // Each part but the last decodes a little past its end, for the join.
    const { preRoll, maxLag, joinWindow } = CONFIG.audio.parallel;
    const overlap = Math.ceil(maxLag * sampleRate) + joinWindow;
    while (workers.length < parts.length) start();
    await unlessAborted(Promise.all(workers.slice(1).map((worker) => worker.open())));
    let results = await unlessAborted(
      Promise.all(
        parts.map(({ from, to }, k) =>
          workers[k].decode({ peakFactor: plan.peakFactor, from, to: to + overlap, preRoll }),
        ),
      ),
    );

    const keep = findJoins(results, parts, sampleRate);
    if (!keep) {
      console.warn(`The ${parts.length} parts of “${media.name}” don't join; decoding it in one part.`);
      results = null; // not kept alive while the track decodes again
      return decodeInWorkers(media, { ...options, workers: 1 });
    }
    const { pieces, levels, frames } = joinParts(results, keep, plan.peakFactor);
    return { pieces, levels, sampleRate, duration: frames / sampleRate };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    for (const worker of workers) worker.terminate();
  }
}

// The whole file at once, as the app first did. Resampled to
// CONFIG.audio.fallbackSampleRate.
/** @param {Media} media @param {DecodeOptions} options @returns {Promise<Decoded>} */
async function decodeWhole(media, { prepare, signal }) {
  const bytes = await readWhole(media);
  if (signal?.aborted) throw aborted();

  const context = new OfflineAudioContext(1, 1, CONFIG.audio.fallbackSampleRate);
  let buffer;
  try {
    buffer = await context.decodeAudioData(bytes);
  } catch (error) {
    throw new DecodeFailure("cannot-decode", String(error?.message ?? error));
  }
  if (signal?.aborted) throw aborted();

  const info = { duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels };
  const { peakFactor } = await prepare(info);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  return { ...info, pieces: [channels], levels: channels.map((samples) => downsampleLevels(samples, peakFactor)) };
}

/**
 * @param {Media} media
 * @param {DecodeOptions} options
 * @returns {Promise<Decoded>}
 */
export async function decodeFile(media, options) {
  try {
    return await decodeInWorkers(media, options);
  } catch (error) {
    if (error instanceof DecodeFailure && error.kind === "cannot-decode") {
      console.debug(`Decoding “${media.name}” in one piece: ${error.message}`);
      return decodeWhole(media, options);
    }
    throw error;
  }
}
