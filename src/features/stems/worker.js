// Stems (src/features/stems/): the page's side of separating one song, off
// its main thread (a module Worker). It decodes the file again (the
// player's samples went to the audio thread when it opened), at 44.1 kHz
// in stereo (what the model hears; core/resample.js for other rates), and
// streams it to the stem process (electron/stems/process.js) over the port
// it's given; then it gathers the stems the process sends back, and hands
// them to the page whole, transferred (no copy). The song and its stems
// never pass through the page's main thread on the way.
//
//   page → { type: "separate", media, port }  media: a File, or { name, url } (core/media.js)
//   ←      { type: "progress", stage: "decode", fraction } … then
//          { type: "progress", stage: "separate", fraction } …
//   ←      { type: "done", sampleRate, length, stems: { [id]: [left, right] } }
//   ←      { type: "error", message }
import { AudioSampleSink } from "../../../node_modules/mediabunny/dist/bundles/mediabunny.mjs";
import { CONFIG } from "../../config.js";
import { createResampler } from "../../core/resample.js";
import { openTrack } from "../../audio/open-track.js";

const scope = /** @type {any} */ (self);
const { sampleRate: RATE, chunk: CHUNK } = CONFIG.stems;

// Progress at most this often, so the page isn't flooded.
const PROGRESS_MS = 100;

function progressReporter(stage) {
  let last = 0;
  return (fraction) => {
    const now = performance.now();
    if (now - last < PROGRESS_MS && fraction < 1) return;
    last = now;
    scope.postMessage({ type: "progress", stage, fraction });
  };
}

// Sends the track, at RATE in stereo, to `port` in chunks; resolves to its
// length in samples. A mono track goes to both sides; a track with more
// channels sends its first two.
async function sendTrack(media, port) {
  const { track, first, duration, sampleRate } = await openTrack(media);
  const resamplers = [createResampler(sampleRate, RATE), createResampler(sampleRate, RATE)];
  const pending = [[], []]; // per channel: resampled chunks not yet sent
  const pendingLength = [0, 0];
  const sent = [0, 0];
  const progress = progressReporter("decode");

  // Sends whole chunks of a channel's resampled samples (all, at the end).
  const flush = (channel, all) => {
    const output = resamplers[channel].take();
    if (output.length) {
      pending[channel].push(output);
      pendingLength[channel] += output.length;
    }
    while (pendingLength[channel] >= CHUNK || (all && pendingLength[channel] > 0)) {
      const size = Math.min(CHUNK, pendingLength[channel]);
      const samples = new Float32Array(size);
      let filled = 0;
      while (filled < size) {
        const head = pending[channel][0];
        const take = Math.min(head.length, size - filled);
        samples.set(head.subarray(0, take), filled);
        filled += take;
        if (take === head.length) pending[channel].shift();
        else pending[channel][0] = head.subarray(take);
      }
      pendingLength[channel] -= size;
      // Copied, not transferred: a message that transfers a buffer never
      // reaches the utility process (Electron's ports only pass ports).
      port.postMessage({ type: "audio", channel, offset: sent[channel], samples });
      sent[channel] += size;
    }
  };

  let plane = new Float32Array(0);
  let at = 0; // the input samples so far
  for await (const sample of new AudioSampleSink(track).samples(first)) {
    try {
      const frames = sample.numberOfFrames;
      // A first sample that starts late: silence before it, so the stems
      // line up with the player's samples.
      const position = Math.round((sample.timestamp - first) * sampleRate);
      if (position > at) {
        const silence = new Float32Array(position - at);
        resamplers.forEach((resampler) => resampler.push(silence));
        at = position;
      }
      if (plane.length < frames) plane = new Float32Array(frames);
      for (const channel of [0, 1]) {
        const planeIndex = Math.min(channel, sample.numberOfChannels - 1);
        sample.copyTo(plane, { planeIndex, format: "f32-planar", frameCount: frames });
        resamplers[channel].push(plane.subarray(0, frames));
        flush(channel, false);
      }
      at += frames;
      if (duration > 0) progress(Math.min(1, at / sampleRate / duration));
    } finally {
      sample.close();
    }
  }
  for (const channel of [0, 1]) {
    resamplers[channel].finish();
    flush(channel, true);
  }
  progress(1);
  return Math.min(sent[0], sent[1]);
}

// Gathers the stems the process sends; resolves to { sampleRate, length, stems }.
function receiveStems(port) {
  const progress = progressReporter("separate");
  return new Promise((resolve, reject) => {
    let gathered = null;
    port.onmessage = ({ data }) => {
      if (data.type === "progress") progress(data.total ? data.done / data.total : 0);
      else if (data.type === "stems") {
        gathered = {
          sampleRate: data.sampleRate,
          length: data.length,
          stems: Object.fromEntries(
            data.names.map((id) => [id, [new Float32Array(data.length), new Float32Array(data.length)]]),
          ),
        };
      } else if (data.type === "stem") gathered.stems[data.name][data.channel].set(data.samples, data.offset);
      else if (data.type === "done") resolve(gathered);
      else if (data.type === "error") reject(new Error(data.message));
    };
  });
}

scope.addEventListener("message", async ({ data }) => {
  if (data?.type !== "separate") return;
  const { media, port } = data;
  try {
    const length = await sendTrack(media, port);
    const received = receiveStems(port);
    port.postMessage({ type: "separate", length });
    const result = await received;
    port.postMessage({ type: "close" });
    const buffers = Object.values(result.stems).flatMap((channels) => channels.map((channel) => channel.buffer));
    scope.postMessage({ type: "done", ...result }, buffers);
  } catch (error) {
    port.close();
    scope.postMessage({ type: "error", message: String(error?.message ?? error) });
  }
});
