// Stems (src/features/stems/): a stem to Opus (in Ogg) and back, for
// keeping it in a project file: about 5 MB a stem for a 4-minute song,
// where its samples take 40. Mediabunny encodes and decodes it (WebCodecs);
// Opus works at 48 kHz, so the stem is resampled to that and back with
// core/resample.js, which keeps every sample where it was (the stems must
// line up with the song to the sample: "other" is the song minus them).
// Runs in the stems worker.
//
// Both go a block at a time, from the stem's 16 bits and back to them, so
// the memory they need doesn't grow with the song (whole, an hour's stem
// passed through about 4 GB of floats on its way: several workers do this
// at once). The resampler gives the same samples streamed as whole.
//
//   encodeStem({ scale, channels }, rate, bitrate) → the Ogg file's bytes
//   decodeStem(bytes, rate, length, scale)         → { scale, channels } at `rate`, `length` long
//   writeInt16(channel, at, samples, scale)        float samples into 16 bits
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
import { CONFIG } from "../../config.js";
import { createResampler } from "../../core/resample.js";

const OPUS_RATE = 48000;
const BLOCK = OPUS_RATE; // samples handed to the encoder at a time (1 s)
const INPUT = 1 << 16; // the stem's samples read at a time

const resamplers = (from, to) => [0, 1].map(() => createResampler(from, to, CONFIG.stems.resampleZeroCrossings));

/**
 * Writes float samples into a stem's channel from `at`, in 16 bits (× `scale`: the samples).
 * @param {Int16Array} channel @param {number} at @param {Float32Array} samples @param {number} scale
 */
export function writeInt16(channel, at, samples, scale) {
  const end = Math.min(channel.length, at + samples.length);
  for (let i = Math.max(0, at); i < end; i++) {
    channel[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i - at] / scale)));
  }
}

/**
 * @param {{ scale: number, channels: Int16Array[] }} stem Its two channels at `rate`, in 16 bits.
 * @param {number} rate
 * @param {number} bitrate In bits per second.
 * @returns {Promise<Uint8Array>}
 */
export async function encodeStem({ scale, channels }, rate, bitrate) {
  const target = new BufferTarget();
  const output = new Output({ format: new OggOutputFormat(), target });
  const source = new AudioSampleSource({ codec: "opus", quality: new Quality({ bitrate }) });
  output.addAudioTrack(source);
  await output.start();

  // The encoder gets whole blocks (the last one shorter) from here.
  const carry = new Float32Array(2 * BLOCK);
  let carried = 0;
  let sent = 0; // samples at 48 kHz handed over
  const send = async () => {
    const data = new Float32Array(2 * carried);
    data.set(carry.subarray(0, carried), 0);
    data.set(carry.subarray(BLOCK, BLOCK + carried), carried);
    const sample = new AudioSample({
      data,
      format: "f32-planar",
      numberOfChannels: 2,
      sampleRate: OPUS_RATE,
      timestamp: sent / OPUS_RATE,
    });
    await source.add(sample);
    sample.close();
    sent += carried;
    carried = 0;
  };
  const sides = resamplers(rate, OPUS_RATE);
  const feed = async () => {
    const [left, right] = sides.map((resampler) => resampler.take());
    for (let at = 0; at < left.length;) {
      const count = Math.min(BLOCK - carried, left.length - at);
      carry.set(left.subarray(at, at + count), carried);
      carry.set(right.subarray(at, at + count), BLOCK + carried);
      carried += count;
      at += count;
      if (carried === BLOCK) await send();
    }
  };

  const length = channels[0].length;
  const floats = new Float32Array(INPUT);
  for (let from = 0; from < length; from += INPUT) {
    const count = Math.min(INPUT, length - from);
    for (const [c, channel] of channels.entries()) {
      for (let i = 0; i < count; i++) floats[i] = channel[from + i] * scale;
      sides[c].push(floats.subarray(0, count));
    }
    await feed();
  }
  sides.forEach((resampler) => resampler.finish());
  await feed();
  if (carried) await send();
  await output.finalize();
  return new Uint8Array(target.buffer);
}

/**
 * @param {Uint8Array} bytes An Ogg Opus file from encodeStem.
 * @param {number} rate The rate to bring it back to.
 * @param {number} length Its length in samples at `rate`.
 * @param {number} scale Its 16 bits × this are the samples.
 * @returns {Promise<{ scale: number, channels: Int16Array[] }>}
 */
export async function decodeStem(bytes, rate, length, scale) {
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) });
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error("no audio in the stem");
  const sourceRate = track.sampleRate;
  const needed = Math.ceil((length * sourceRate) / rate) + 1; // the samples at sourceRate used
  const sides = resamplers(sourceRate, rate);
  const channels = [new Int16Array(length), new Int16Array(length)];
  let pushed = 0; // the decoded samples (at sourceRate) passed on so far
  let written = 0; // the samples at `rate` made so far
  const drain = () => {
    const [left, right] = sides.map((resampler) => resampler.take());
    writeInt16(channels[0], written, left, scale);
    writeInt16(channels[1], written, right, scale);
    written += left.length;
  };
  const silence = (count) => {
    const zeros = new Float32Array(count);
    sides.forEach((resampler) => resampler.push(zeros));
    pushed += count;
  };

  // Each decoded block where its timestamp puts it: the encoder's lead-in
  // (before 0) left out, any gap silent.
  let plane = new Float32Array(0);
  for await (const sample of new AudioSampleSink(track).samples()) {
    try {
      const frames = sample.numberOfFrames;
      const at = Math.round(sample.timestamp * sourceRate);
      if (Math.min(at, needed) > pushed) silence(Math.min(at, needed) - pushed);
      const skip = Math.max(0, pushed - at);
      const count = Math.min(frames, needed - at) - skip;
      if (count <= 0) continue;
      if (plane.length < frames) plane = new Float32Array(frames);
      for (const channel of [0, 1]) {
        const planeIndex = Math.min(channel, sample.numberOfChannels - 1);
        sample.copyTo(plane, { planeIndex, format: "f32-planar", frameCount: frames });
        sides[channel].push(plane.subarray(skip, skip + count));
      }
      pushed += count;
      drain();
    } finally {
      sample.close();
    }
  }
  if (pushed < needed) silence(needed - pushed);
  sides.forEach((resampler) => resampler.finish());
  drain();
  return { scale, channels };
}
