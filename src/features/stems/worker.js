// Stems (src/features/stems/): the page's side of separating one song, and
// of bringing back a project's stems, off its main thread (a module
// Worker).
//
// Separating: it decodes the file again (the player's samples went to the
// audio thread when it opened), at 44.1 kHz in stereo (what the model
// hears; core/resample.js for other rates), and streams it to the stem
// process (electron/stems/process.js) over the port it's given; then it
// gathers the stems the process sends back, at the track's own rate in 16
// bits (what the player mixes them from: audio/engine.js), hands them over
// to be played, and then encodes each as Opus (opus.js) for saving in a
// project, while they already play. The song and its stems never pass
// through the page's main thread on the way.
//
// Loading: a project's Opus stems decoded back to the same form.
//
//   page → { type: "separate", media, port }  media: a File, or { name, url } (core/media.js)
//   ←      { type: "progress", stage: "decode" | "separate" | "encode", fraction } …
//   page → { type: "load", audio: { [id]: bytes }, sampleRate, length }
//   ←      { type: "progress", stage: "load", fraction } …
//   ←      { type: "stems", sampleRate, length, stems: { [id]: { scale, channels, level } } }
//          to play, at the track's own rate: each channel an Int16Array
//          (× scale: the samples), level its loudness
//   ←      { type: "done", audio }  each stem's Opus bytes, for the project
//          (after "encode" progress, when separating)
//   ←      { type: "error", message }
import { AudioSampleSink } from "../../../node_modules/mediabunny/dist/bundles/mediabunny.mjs";
import { CONFIG } from "../../config.js";
import { createResampler, resampleRatio } from "../../core/resample.js";
import { openTrack } from "../../audio/open-track.js";
import { decodeStem, encodeStem } from "./opus.js";

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
// length in samples (at RATE) and its own sample rate. A mono track goes to both sides; a track with more
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
  return { length: Math.min(sent[0], sent[1]), sampleRate };
}

// Gathers the stems the process sends, each channel turned back to the
// track's rate (`rate`) and into 16 bits as its chunks arrive, so the 44.1
// kHz floats are never all held; resolves to { sampleRate, length, stems }.
function receiveStems(port, rate) {
  const progress = progressReporter("separate");
  return new Promise((resolve, reject) => {
    let gathered = null;
    let sentLength = 0; // the process's length, at its rate
    const writers = new Map(); // "<id>/<channel>" → { resampler, at }

    // Appends resampled samples to a stem's channel, in 16 bits.
    const write = (stem, channel, writer, samples) => {
      const out = stem.channels[channel];
      const end = Math.min(out.length, writer.at + samples.length);
      for (let i = writer.at; i < end; i++) {
        out[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i - writer.at] / stem.scale)));
      }
      writer.at = end;
    };

    port.onmessage = ({ data }) => {
      if (data.type === "progress") progress(data.total ? data.done / data.total : 0);
      else if (data.type === "stems") {
        sentLength = data.length;
        const { up, down } = resampleRatio(data.sampleRate, rate);
        const length = Math.ceil((data.length * up) / down);
        gathered = {
          sampleRate: rate,
          length,
          stems: Object.fromEntries(
            data.names.map((id, i) => [
              id,
              {
                scale: Math.max(data.peaks[i], 1e-6) / 32767,
                channels: [new Int16Array(length), new Int16Array(length)],
              },
            ]),
          ),
        };
        for (const id of data.names) {
          for (const channel of [0, 1]) {
            writers.set(`${id}/${channel}`, { resampler: createResampler(data.sampleRate, rate), at: 0 });
          }
        }
      } else if (data.type === "stem") {
        const stem = gathered.stems[data.name];
        const writer = writers.get(`${data.name}/${data.channel}`);
        writer.resampler.push(data.samples);
        write(stem, data.channel, writer, writer.resampler.take());
        if (data.offset + data.samples.length >= sentLength) {
          writer.resampler.finish();
          write(stem, data.channel, writer, writer.resampler.take());
        }
      } else if (data.type === "done") resolve(gathered);
      else if (data.type === "error") reject(new Error(data.message));
    };
  });
}

// A stem's loudness (its two channels' RMS, added), for the tests.
function level({ scale, channels }) {
  return channels.reduce((sum, channel) => {
    let squares = 0;
    for (let i = 0; i < channel.length; i++) squares += channel[i] * channel[i];
    return sum + Math.sqrt(squares / Math.max(1, channel.length)) * scale;
  }, 0);
}

// A stem in 16 bits, scaled to its loudest sample.
/** @param {Float32Array[]} channels */
function quantize(channels) {
  const peak = channels.reduce((most, channel) => channel.reduce((m, v) => Math.max(m, Math.abs(v)), most), 0);
  const scale = Math.max(peak, 1e-6) / 32767;
  const ints = channels.map((channel) => Int16Array.from(channel, (v) => Math.round(v / scale)));
  return { scale, channels: ints };
}

// Each stem as Opus, from its 16 bits.
async function encodeAll(stems, rate) {
  const progress = progressReporter("encode");
  const audio = {};
  const ids = Object.keys(stems);
  for (const [index, id] of ids.entries()) {
    const { scale, channels } = stems[id];
    const floats = channels.map((channel) => Float32Array.from(channel, (v) => v * scale));
    audio[id] = await encodeStem(floats, rate, CONFIG.stems.bitrate);
    progress((index + 1) / ids.length);
  }
  return audio;
}

// A project's Opus stems, decoded back.
async function decodeAll(audio, rate, length) {
  const progress = progressReporter("load");
  const stems = {};
  const ids = Object.keys(audio);
  for (const [index, id] of ids.entries()) {
    stems[id] = quantize(await decodeStem(audio[id], rate, length));
    progress((index + 1) / ids.length);
  }
  return stems;
}

// Hands the stems over to be played, their samples transferred; `keep`:
// copies, so the worker keeps its own (to encode).
function handOver({ sampleRate, length, stems }, keep) {
  const copies = Object.fromEntries(
    Object.entries(stems).map(([id, { scale, channels }]) => {
      const stem = { scale, channels: keep ? channels.map((channel) => channel.slice()) : channels };
      return [id, { ...stem, level: level(stem) }];
    }),
  );
  const buffers = Object.values(copies).flatMap((stem) => stem.channels.map((channel) => channel.buffer));
  scope.postMessage({ type: "stems", sampleRate, length, stems: copies }, buffers);
}

scope.addEventListener("message", async ({ data }) => {
  if (data?.type === "separate") {
    const { media, port } = data;
    try {
      const { length, sampleRate } = await sendTrack(media, port);
      const received = receiveStems(port, sampleRate);
      port.postMessage({ type: "separate", length });
      const result = await received;
      port.postMessage({ type: "close" });
      handOver(result, true);
      scope.postMessage({ type: "done", audio: await encodeAll(result.stems, result.sampleRate) });
    } catch (error) {
      port.close();
      scope.postMessage({ type: "error", message: String(error?.message ?? error) });
    }
  } else if (data?.type === "load") {
    const { audio, sampleRate, length } = data;
    try {
      handOver({ sampleRate, length, stems: await decodeAll(audio, sampleRate, length) }, false);
      scope.postMessage({ type: "done", audio });
    } catch (error) {
      scope.postMessage({ type: "error", message: String(error?.message ?? error) });
    }
  }
});
