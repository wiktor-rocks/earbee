// Prepares one file for finding its beats, off the page's main thread (a
// module Worker; features/beats.js is the page side, which runs a few of
// these at once). It decodes the file again rather than use the player's
// samples: those were handed to the audio thread when the file opened
// (audio/engine.js).
//
// The beat model's input is made one 30 s window at a time, in the order
// the page asks for them (the cursor's first), so the model can start on
// the first window while the next ones are being prepared. Each is decoded
// from a little before it (the decoder warms up, the resampler too), mixed
// to mono, resampled to 22,050 Hz (core/resample.js) and turned into its
// frames of the log-mel spectrogram (core/melspec.js): exactly the frames
// the whole track's spectrogram has there (core/beat-this.js
// windowSource, createWindowSpectrogram).
//
// For when the model can't run, it also gives the simple beat finder's
// answer (core/beats.js), from one pass over the whole track.
//
// Messages:
//   page → { type: "open", media }  (a File, or { name, url }: core/media.js)
//   ←      { type: "info", duration, sampleRate, frames }
//          frames: the whole track's spectrogram frames (core/beat-this.js framesFor)
//   page → { type: "window", start }  a window's first frame (core/beat-this.js windowStarts)
//   ←      { type: "window", start, spect }  its frames × 128 values, from
//          frame max(start, 0)
//   page → { type: "simple" }
//   ←      { type: "progress", fraction } …  (at most every 100 ms)
//   ←      { type: "simple", beats, bpm }  times in seconds from the track's
//          first sample, as the player counts
// or at any point ← { type: "error", kind, message }, kind as in decode-worker.js
import { AudioSampleSink } from "../../node_modules/mediabunny/dist/bundles/mediabunny.mjs";
import { CONFIG } from "../config.js";
import { createWindowSpectrogram, framesFor, windowSource } from "../core/beat-this.js";
import { createOnsetDetector, detectBeats } from "../core/beats.js";
import { DecodeError, openTrack } from "./open-track.js";

const scope = /** @type {any} */ (self);

let opened = null; // the track (open-track.js), and its `frames`

// Calls `each(mono, at)` with the track's samples mixed to mono, in
// chunks, from input sample `from` (by the timestamps; decoding starts
// `preRoll` seconds earlier, so the decoder has warmed up) until at least
// `to` (Infinity: the end); `at` is the chunk's first sample. Mixed as the
// beat finders always have: each channel / channels.
async function eachMono({ track, first, sampleRate }, from, to, preRoll, each) {
  const start = from === 0 ? first : Math.max(first, first + from / sampleRate - preRoll);
  const end = Number.isFinite(to) ? first + to / sampleRate + 0.1 : undefined; // a little past: whole chunks
  let plane = new Float32Array(0);
  let mono = new Float32Array(0);
  let at = -1; // the input sample the next chunk starts with, once started
  for await (const sample of new AudioSampleSink(track).samples(start, end)) {
    try {
      const frames = sample.numberOfFrames;
      let skip = 0;
      if (at < 0) {
        // Warming up: drop what comes before `from`.
        const position = Math.round((sample.timestamp - first) * sampleRate);
        if (position + frames <= from) continue;
        skip = Math.max(0, from - position);
        at = position + skip;
      }
      const count = frames - skip;
      if (plane.length < count) [plane, mono] = [new Float32Array(count), new Float32Array(count)];
      const channels = sample.numberOfChannels;
      mono.fill(0, 0, count);
      for (let c = 0; c < channels; c++) {
        sample.copyTo(plane, { planeIndex: c, format: "f32-planar", frameOffset: skip, frameCount: count });
        for (let i = 0; i < count; i++) mono[i] += plane[i] / channels;
      }
      each(mono.subarray(0, count), at);
      at += count;
    } finally {
      sample.close();
    }
    if (at >= to) break; // also stops the decoder
  }
}

async function open(media) {
  const track = await openTrack(media);
  const frames = framesFor(Math.round(track.duration * track.sampleRate), track.sampleRate);
  opened = { ...track, frames };
  return { duration: track.duration, sampleRate: track.sampleRate, frames };
}

async function prepareWindow(start) {
  const source = windowSource(start, opened.frames, opened.sampleRate);
  const spectrogram = createWindowSpectrogram(source, opened.sampleRate);
  await eachMono(opened, source.inFrom, source.inTo, CONFIG.audio.parallel.preRoll, (mono) => spectrogram.push(mono));
  return spectrogram.finish();
}

async function simple() {
  const { sampleRate, duration } = opened;
  const onsets = createOnsetDetector(sampleRate);
  let reportedAt = -Infinity;
  await eachMono(opened, 0, Infinity, 0, (mono, at) => {
    onsets.push(mono);
    const now = performance.now();
    if (now - reportedAt > 100 && duration > 0) {
      reportedAt = now;
      scope.postMessage({ type: "progress", fraction: Math.min(1, at / sampleRate / duration) });
    }
  });
  const { envelope, frameRate } = onsets.finish();
  return detectBeats(envelope, frameRate);
}

// One request at a time: the page waits for each answer before it asks
// this worker again.
scope.onmessage = async ({ data }) => {
  try {
    if (data.type === "open") {
      scope.postMessage({ type: "info", ...(await open(data.media)) });
    } else if (data.type === "window") {
      const spect = await prepareWindow(data.start);
      scope.postMessage({ type: "window", start: data.start, spect }, [spect.buffer]);
    } else if (data.type === "simple") {
      const { beats, bpm } = await simple();
      scope.postMessage({ type: "simple", beats, bpm }, [beats.buffer]);
    }
  } catch (error) {
    const kind = error instanceof DecodeError ? error.kind : error instanceof RangeError ? "out-of-memory" : "failed";
    scope.postMessage({ type: "error", kind, message: String(error?.message ?? error) });
  }
};
