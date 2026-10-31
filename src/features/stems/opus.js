// Stems (src/features/stems/): a stem to Opus (in Ogg) and back, for
// keeping it in a project file: about 5 MB a stem for a 4-minute song,
// where its samples take 40. Mediabunny encodes and decodes it (WebCodecs);
// Opus works at 48 kHz, so the stem is resampled to that and back with
// core/resample.js, which keeps every sample where it was (the stems must
// line up with the song to the sample: "other" is the song minus them).
// Runs in the stems worker.
//
//   encodeStem(channels, rate, bitrate) → the Ogg file's bytes
//   decodeStem(bytes, rate, length)     → its channels at `rate`, `length` long
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BufferSource,
  BufferTarget,
  Input,
  OggOutputFormat,
  Output,
  Quality,
} from "../../../node_modules/mediabunny/dist/bundles/mediabunny.mjs";
import { createResampler } from "../../core/resample.js";

const OPUS_RATE = 48000;
const BLOCK = OPUS_RATE; // samples handed to the encoder at a time (1 s)

/** @param {Float32Array} samples @param {number} from @param {number} to */
function resampled(samples, from, to) {
  const resampler = createResampler(from, to);
  resampler.push(samples);
  resampler.finish();
  return resampler.take();
}

/**
 * @param {Float32Array[]} channels A stem's two channels, at `rate`.
 * @param {number} rate
 * @param {number} bitrate In bits per second.
 * @returns {Promise<Uint8Array>}
 */
export async function encodeStem(channels, rate, bitrate) {
  const [left, right] = channels.map((channel) => resampled(channel, rate, OPUS_RATE));
  const target = new BufferTarget();
  const output = new Output({ format: new OggOutputFormat(), target });
  const source = new AudioSampleSource({ codec: "opus", quality: new Quality({ bitrate }) });
  output.addAudioTrack(source);
  await output.start();
  for (let from = 0; from < left.length; from += BLOCK) {
    const count = Math.min(BLOCK, left.length - from);
    const data = new Float32Array(2 * count);
    data.set(left.subarray(from, from + count), 0);
    data.set(right.subarray(from, from + count), count);
    const sample = new AudioSample({
      data,
      format: "f32-planar",
      numberOfChannels: 2,
      sampleRate: OPUS_RATE,
      timestamp: from / OPUS_RATE,
    });
    await source.add(sample);
    sample.close();
  }
  await output.finalize();
  return new Uint8Array(target.buffer);
}

/**
 * @param {Uint8Array} bytes An Ogg Opus file from encodeStem.
 * @param {number} rate The rate to bring it back to.
 * @param {number} length Its length in samples at `rate`.
 * @returns {Promise<Float32Array[]>}
 */
export async function decodeStem(bytes, rate, length) {
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) });
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error("no audio in the stem");
  const sourceRate = track.sampleRate;
  // Each decoded block where its timestamp puts it (the encoder's lead-in
  // has none: it's before 0).
  const needed = Math.ceil((length * sourceRate) / rate) + 1;
  const planes = [new Float32Array(needed), new Float32Array(needed)];
  let plane = new Float32Array(0);
  for await (const sample of new AudioSampleSink(track).samples()) {
    try {
      const frames = sample.numberOfFrames;
      const at = Math.round(sample.timestamp * sourceRate);
      if (plane.length < frames) plane = new Float32Array(frames);
      for (const channel of [0, 1]) {
        const planeIndex = Math.min(channel, sample.numberOfChannels - 1);
        sample.copyTo(plane, { planeIndex, format: "f32-planar", frameCount: frames });
        const skip = Math.max(0, -at);
        const count = Math.min(frames, needed - at) - skip;
        if (count > 0) planes[channel].set(plane.subarray(skip, skip + count), at + skip);
      }
    } finally {
      sample.close();
    }
  }
  return planes.map((samples) => {
    const back = resampled(samples, sourceRate, rate);
    if (back.length === length) return back;
    const exact = new Float32Array(length); // a sample or two over or short
    exact.set(back.subarray(0, length));
    return exact;
  });
}
