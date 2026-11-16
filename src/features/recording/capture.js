// Recording (src/features/recording/): the sound input, recorded so that
// every sample has a time on the clock the track plays by (takes.js says
// why that matters). Nothing of it is heard: no monitoring.
//
// The input is opened as it is, without the browser's voice processing
// (echo cancellation, noise suppression, automatic gain: made for calls,
// they'd mangle an instrument and add delay).
//
// Its timing comes from the browser's own stamps, not from when the sound
// reaches the page. Each chunk of the input says when it was captured, on
// the page's clock (performance.now). The player's AudioContext says, as
// often as asked, which of its samples is leaving for the speakers at
// which moment on that same clock (getOutputTimestamp): the "tie" between
// the two clocks, noisy each time, steady in the middle of many. So a
// chunk captured at T was played while the track's sound rendered at
// (T − tie) was heard, whatever buffers the sound waited in on the way in.
// Measured (2026-11, a loop from the output back into an input, opened ten
// times): the same to about 2 ms each time, where reading the input inside
// the AudioContext moved by 20 ms from one opening to the next. What's
// left is a constant, the nudge.
//
//   listInputs()                       the inputs there are, the system's default aside: [{ id, label }]
//   openInput(deviceId)                the input (the system's default without an id): a MediaStream
//   startCapture(context, stream, { onLevel, keep })
//     → { stop() → Recording (takes.js): mono, at the input's own rate }
//     onLevel(peak) hears each chunk's loudest sample (0…1), for a meter;
//     with `keep` false nothing is kept (only listening, for the meter).
import { AppError } from "../../core/errors.js";

const TIE_MS = 20; // how often the two clocks are tied while recording
const TIE_WINDOW = 500; // a chunk's tie: the middle one of those within this many ms of it

const median = (values) => values.toSorted((a, b) => a - b)[values.length >> 1];

/** The sound inputs, named once the user has allowed one to be opened. */
export async function listInputs() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  // Chromium lists the system's default (and the one for calls) again, under ids of their own.
  return devices
    .filter((device) => device.kind === "audioinput" && !["default", "communications"].includes(device.deviceId))
    .map((device) => ({ id: device.deviceId, label: device.label }));
}

/** @param {string} [deviceId] */
export async function openInput(deviceId) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (error) {
    throw new AppError(
      error?.name === "NotFoundError" || error?.name === "OverconstrainedError"
        ? "The sound input wasn't found. Is it plugged in?"
        : "The sound input couldn't be opened.",
      error,
    );
  }
}

/**
 * When the first of a recording's samples was played, on the render clock
 * (seconds): each chunk's own answer (its capture time less the tie around
 * then, less the samples before it), and the middle one of them all.
 * @param {{ at: number, before: number }[]} chunks Each one's capture time (ms) and the samples before it.
 * @param {{ at: number, tie: number }[]} ties
 * @param {number} sampleRate
 */
export function firstSampleTime(chunks, ties, sampleRate) {
  if (!chunks.length || !ties.length) return 0;
  let from = 0;
  const answers = chunks.map(({ at, before }) => {
    while (from < ties.length - 1 && ties[from].at < at - TIE_WINDOW) from++;
    let to = from;
    while (to < ties.length && ties[to].at <= at + TIE_WINDOW) to++;
    // None that near (the page was held up): the nearest there is.
    const near = to > from ? ties.slice(from, to) : [ties[Math.min(from, ties.length - 1)]];
    return (at - median(near.map(({ tie }) => tie))) / 1000 - before / sampleRate;
  });
  return median(answers);
}

/**
 * @param {AudioContext} context The player's: the clock the recording's time is on.
 * @param {MediaStream} stream
 * @param {{ onLevel?: (peak: number) => void, keep?: boolean }} [options]
 */
export function startCapture(context, stream, { onLevel, keep = true } = {}) {
  const Processor = /** @type {any} */ (globalThis).MediaStreamTrackProcessor;
  if (!Processor) throw new AppError("This version of the browser can't record the input.");
  /** @type {ReadableStreamDefaultReader<any>} */
  const reader = new Processor({ track: stream.getAudioTracks()[0] }).readable.getReader();

  /** @type {{ at: number, tie: number }[]} */
  const ties = [];
  const tieTimer = setInterval(() => {
    const { contextTime, performanceTime } = context.getOutputTimestamp();
    if (contextTime > 0) ties.push({ at: performanceTime, tie: performanceTime - contextTime * 1000 });
  }, TIE_MS);

  /** @type {{ at: number, before: number, samples: Float32Array }[]} */
  const chunks = [];
  let sampleRate = context.sampleRate;
  let length = 0;
  /** @type {Float32Array | null} */
  let plane = null; // one channel of a chunk, on its way into the mix

  const reading = (async () => {
    for (;;) {
      const { value: data, done } = await reader.read();
      if (done) return;
      try {
        const frames = data.numberOfFrames;
        const samples = new Float32Array(frames);
        if (!plane || plane.length !== frames) plane = new Float32Array(frames);
        // The input's channels into one: their average.
        for (let channel = 0; channel < data.numberOfChannels; channel++) {
          data.copyTo(plane, { planeIndex: channel, format: "f32-planar" });
          for (let i = 0; i < frames; i++) samples[i] += plane[i] / data.numberOfChannels;
        }
        sampleRate = data.sampleRate;
        if (keep) chunks.push({ at: data.timestamp / 1000, before: length, samples });
        length += frames;
        if (onLevel) {
          let peak = 0;
          for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
          onLevel(peak);
        }
      } finally {
        data.close();
      }
    }
  })();

  return {
    /**
     * Ends it, and gives what was recorded.
     * @returns {Promise<import("./takes.js").Recording>}
     */
    async stop() {
      clearInterval(tieTimer);
      await reader.cancel().catch(() => {});
      await reading.catch(() => {});
      const samples = new Float32Array(keep ? length : 0);
      for (const chunk of chunks) samples.set(chunk.samples, chunk.before);
      return { samples, sampleRate, time: firstSampleTime(chunks, ties, sampleRate) };
    },
  };
}
