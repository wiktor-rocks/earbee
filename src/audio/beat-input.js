import { CONFIG } from "../config.js";

/* =====================================================================
 * BEAT INPUT
 * The page side of beat-worker.js: a few of those workers on one file,
 * preparing the beat model's input window by window (features/beats.js
 * asks for the windows and runs the model).
 *
 * openBeatInput(media, count):
 *   info           a Promise of { duration, sampleRate, frames }; rejects
 *                  if the file can't be read, or if no worker has answered
 *                  within CONFIG.beats.startTimeoutMs (a worker that never
 *                  starts would otherwise leave the search at 0 %)
 *   window(start)  a Promise of that window's spectrogram (beat-worker.js),
 *                  prepared by the next free worker; asking for more than
 *                  `count` at once queues them
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
  return { opened, ask, terminate: () => worker.terminate() };
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
