import { CONFIG } from "../config.js";
import { downsamplePeaks } from "../core/peaks.js";

/* =====================================================================
 * DECODER
 * The audio of a file as one Float32Array per channel, at the file's own
 * sample rate, plus the waveform peaks. Normally decoded in chunks by
 * decode-worker.js; formats it can't read fall back to decodeAudioData
 * on the whole file (the old way, fine for short files).
 *
 * decodeFile(file, { prepare, onProgress, signal }):
 *   prepare(info)  called once the track is known, before decoding:
 *                  info = { duration, sampleRate, channels }; returns the
 *                  peak factor (samples per peak), or throws to refuse
 *                  the file (e.g. it won't fit in memory)
 *   onProgress(f)  0…1 while decoding (not for the fallback)
 *   signal         aborting stops the decoding (rejects with AbortError)
 * Resolves to { channels, peaks, sampleRate, duration }.
 * Rejects with a DecodeFailure (kind: see decode-worker.js) when the file
 * can't be decoded, or with whatever prepare() threw.
 * ===================================================================== */

export class DecodeFailure extends Error {
  /** @param {"cannot-decode" | "no-audio" | "out-of-memory" | "failed"} kind */
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/**
 * @typedef {object} DecodeOptions
 * @property {(info: { duration: number, sampleRate: number, channels: number }) => number | Promise<number>} prepare
 * @property {(fraction: number) => void} [onProgress]
 * @property {AbortSignal} [signal]
 */

const aborted = () => new DOMException("Decoding was canceled.", "AbortError");

/** @param {File} file @param {DecodeOptions} options */
function decodeInWorker(file, { prepare, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL("./decode-worker.js", import.meta.url), { type: "module" });
    } catch (error) {
      reject(new DecodeFailure("cannot-decode", `no decode worker: ${error}`));
      return;
    }

    let settled = false;
    function settle(finish, value) {
      if (settled) return;
      settled = true;
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
      finish(value);
    }
    const onAbort = () => settle(reject, aborted());
    signal?.addEventListener("abort", onAbort);

    // The worker script failed to load or crashed.
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      settle(reject, new DecodeFailure("cannot-decode", `decode worker failed: ${event.message}`));
    });

    worker.addEventListener("message", async ({ data }) => {
      if (settled) return;
      if (data.type === "info") {
        try {
          const peakFactor = await prepare(data);
          if (!settled) worker.postMessage({ type: "decode", peakFactor });
        } catch (error) {
          settle(reject, error);
        }
      } else if (data.type === "progress") {
        onProgress?.(data.fraction);
      } else if (data.type === "done") {
        settle(resolve, data);
      } else if (data.type === "error") {
        settle(reject, new DecodeFailure(data.kind, data.message));
      }
    });

    worker.postMessage({ type: "open", file });
  });
}

// The whole file at once, as the app first did. Resampled to
// CONFIG.audio.fallbackSampleRate.
/** @param {File} file @param {DecodeOptions} options */
async function decodeWhole(file, { prepare, signal }) {
  const bytes = await file.arrayBuffer();
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
  const peakFactor = await prepare(info);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  return { ...info, channels, peaks: channels.map((samples) => downsamplePeaks(samples, peakFactor)) };
}

/**
 * @param {File} file
 * @param {DecodeOptions} options
 * @returns {Promise<{ channels: Float32Array[], peaks: Float32Array[], sampleRate: number, duration: number }>}
 */
export async function decodeFile(file, options) {
  try {
    return await decodeInWorker(file, options);
  } catch (error) {
    if (error instanceof DecodeFailure && error.kind === "cannot-decode") {
      console.debug(`Decoding “${file.name}” in one piece: ${error.message}`);
      return decodeWhole(file, options);
    }
    throw error;
  }
}
