import { CONFIG } from "../config.js";

/* =====================================================================
 * BEAT INPUT
 * The page side of beat-worker.js: a few of those workers on one file,
 * preparing the beat model's input window by window (features/beats.js
 * asks for the windows and runs the model).
 *
 * openBeatInput(media, count):
 *   info           a Promise of { duration, sampleRate, frames, exact }; rejects
 *                  if the file can't be read, or if no worker has answered
 *                  within CONFIG.beats.startTimeoutMs (a worker that never
 *                  starts would otherwise leave the search at 0 %)
 *   window(start)  a Promise of that window's spectrogram (beat-worker.js),
 *                  prepared by the next free worker; asking for more than
 *                  `count` at once queues them. Only when `exact`
 *   stream(starts) every window, from one pass over the track by one
 *                  worker (for files that aren't `exact`): a Promise of
 *                  each window's spectrogram, in the order of `starts`;
 *                  they're kept in time order, as the pass goes
 *   simple(onProgress)  a Promise of the simple beat finder's { beats, bpm }
 *                  for the whole track; onProgress(0…1) meanwhile
 *   close()        stops every worker; what's pending is never answered
 * Failures reject with a BeatInputFailure, whose `kind` is one of
 * decode-worker.js's.
 * ===================================================================== */

export class BeatInputFailure extends Error {
  /** @param {string} kind @param {string} message */
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

// One worker, opened on `media`; ask() resolves with its next answer.
function startWorker(media, onProgress) {
  const worker = new Worker(new URL("./beat-worker.js", import.meta.url), { type: "module" });
  let pending = null;
  let onWindow = null; // while streaming
  const settle = (outcome, value) => {
    const request = pending;
    pending = null;
    request?.[outcome](value);
  };
  worker.addEventListener("error", (event) => {
    event.preventDefault();
    settle("reject", new BeatInputFailure("failed", event.message || "the beat finder stopped"));
  });
  worker.addEventListener("message", ({ data }) => {
    if (data.type === "progress") onProgress(data.fraction);
    else if (data.type === "window" && onWindow) onWindow(data);
    else if (data.type === "error") settle("reject", new BeatInputFailure(data.kind, data.message));
    else settle("resolve", data);
  });
  const ask = (message) =>
    new Promise((resolve, reject) => {
      pending = { resolve, reject };
      worker.postMessage(message);
    });
  const opened = ask({ type: "open", media });
  opened.catch(() => {}); // seen through `info`, or by the first request
  /** @param {number[]} starts @param {(answer: any) => void} each */
  const stream = (starts, each) => {
    onWindow = each;
    return ask({ type: "stream", starts }).finally(() => (onWindow = null));
  };
  return { opened, ask, stream, terminate: () => worker.terminate() };
}

/**
 * @param {import("../core/media.js").Media} media
 * @param {number} count
 */
export function openBeatInput(media, count) {
  /** @type {(fraction: number) => void} */
  let onProgress = () => {};
  const workers = Array.from({ length: Math.max(1, count) }, () => startWorker(media, (f) => onProgress(f)));
  const idle = [...workers];
  const queue = [];

  // Gives the next request to an idle worker, once it has opened the file.
  function dispatch() {
    while (idle.length && queue.length) {
      const worker = idle.shift();
      const { message, resolve, reject } = queue.shift();
      worker.opened
        .then(() => worker.ask(message))
        .then(resolve, reject)
        .finally(() => {
          idle.push(worker);
          dispatch();
        });
    }
  }
  const request = (message) =>
    new Promise((resolve, reject) => {
      queue.push({ message, resolve, reject });
      dispatch();
    });

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new BeatInputFailure("failed", "the beat finder didn't start")),
      CONFIG.beats.startTimeoutMs,
    );
  });
  const info = Promise.race([workers[0].opened, timeout]).finally(() => clearTimeout(timer));
  info.catch(() => {});

  return {
    info,
    /** @param {number} start @returns {Promise<Float32Array>} */
    window: (start) => request({ type: "window", start }).then((answer) => answer.spect),
    /** @param {number[]} starts @returns {Promise<Float32Array>[]} */
    stream(starts) {
      const worker = workers[0];
      idle.splice(idle.indexOf(worker), 1); // its own from now on
      const waiting = new Map();
      for (const start of starts) {
        const entry = {};
        entry.promise = new Promise((resolve, reject) => Object.assign(entry, { resolve, reject }));
        entry.promise.catch(() => {}); // seen when its turn comes
        waiting.set(start, entry);
      }
      const failAll = (error) => {
        for (const { reject } of waiting.values()) reject(error);
      };
      worker.opened
        .then(() => worker.stream(starts, ({ start, spect }) => waiting.get(start)?.resolve(spect)))
        // A window the pass didn't send (it never should) fails rather than waits.
        .then(() => failAll(new BeatInputFailure("failed", "a part of the track was missing")), failAll);
      return starts.map((start) => waiting.get(start).promise);
    },
    /** @param {(fraction: number) => void} [progress] @returns {Promise<{ beats: Float64Array, bpm: number | null }>} */
    simple(progress) {
      onProgress = progress ?? (() => {});
      return request({ type: "simple" });
    },
    close() {
      clearTimeout(timer);
      for (const worker of workers) worker.terminate();
    },
  };
}
