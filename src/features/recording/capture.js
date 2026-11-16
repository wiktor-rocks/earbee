// Recording (src/features/recording/): the sound input, recorded in the
// player's own AudioContext, so its samples are on the same clock as the
// track (takes.js says why that matters). Nothing of it is heard: no
// monitoring.
//
// The input is opened as it is, without the browser's voice processing
// (echo cancellation, noise suppression, automatic gain: made for calls,
// they'd mangle an instrument and add delay). A worklet
// (capture-worklet.js) collects the samples; stopping joins them into one
// recording.
//
//   listInputs()                       the inputs there are, the system's default aside: [{ id, label }]
//   openInput(deviceId)                the input (the system's default without an id): a MediaStream
//   startCapture(context, stream, { channel, delay, onLevel, keep })
//     → { inputDelay, stop() → Recording (takes.js) }
//     onLevel(peak) hears each chunk's loudest sample (0…1), for a meter;
//     with `keep` false nothing is kept (only listening, for the meter).
//     `delay`: the seconds from the player rendering a sound to it being
//     heard (the output's delay); the input's own, as the system reports
//     it, is added, and both are taken off the recording's time.
import { AppError } from "../../core/errors.js";

const worklet = new URL("./capture-worklet.js", import.meta.url);
/** @type {WeakSet<BaseAudioContext>} */
const loaded = new WeakSet(); // the contexts the worklet is loaded into

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
 * @param {AudioContext} context
 * @param {MediaStream} stream
 * @param {{ channel: number | "mix", delay: number, onLevel?: (peak: number) => void, keep?: boolean }} options
 */
export async function startCapture(context, stream, { channel, delay, onLevel, keep = true }) {
  if (!loaded.has(context)) {
    await context.audioWorklet.addModule(worklet);
    loaded.add(context);
  }
  // The input's delay as the system reports it (seconds; not in the types yet).
  const inputDelay = /** @type {any} */ (stream.getAudioTracks()[0]?.getSettings())?.latency ?? 0;

  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "earbee-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    processorOptions: { channel },
  });
  // The worklet only runs while it leads somewhere: into a gain of 0.
  const silence = context.createGain();
  silence.gain.value = 0;
  source.connect(node).connect(silence).connect(context.destination);

  /** @type {{ frame: number, samples: Float32Array }[]} */
  const chunks = [];
  /** @type {(() => void) | null} */
  let finished = null;
  node.port.onmessage = ({ data }) => {
    if (data.done) return finished?.();
    if (keep) chunks.push(data);
    if (!onLevel) return;
    let peak = 0;
    for (const sample of data.samples) peak = Math.max(peak, Math.abs(sample));
    onLevel(peak);
  };
  node.port.postMessage({ on: true });

  return {
    inputDelay,
    /**
     * Ends it, and gives what was recorded.
     * @returns {Promise<import("./takes.js").Recording>}
     */
    async stop() {
      // The worklet answers with what it still held; not if its context
      // was closed meanwhile (a track at another rate was opened).
      await new Promise((resolve) => {
        finished = () => resolve(undefined);
        node.port.postMessage({ on: false });
        setTimeout(resolve, 500);
      });
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      silence.disconnect();

      // Each chunk goes where its frame says, so a gap in the input (it
      // stalled) stays a gap: what follows isn't moved earlier.
      const first = chunks[0]?.frame ?? 0;
      const last = chunks.at(-1);
      const samples = new Float32Array(last ? last.frame + last.samples.length - first : 0);
      for (const chunk of chunks) samples.set(chunk.samples, chunk.frame - first);
      return { samples, sampleRate: context.sampleRate, time: first / context.sampleRate - delay - inputDelay };
    },
  };
}
