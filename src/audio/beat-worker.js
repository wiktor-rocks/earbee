// Prepares one file for finding its beats, off the page's main thread (a
// module Worker; features/beats.js is the page side, which runs a few of
// these at once). It decodes the file again rather than use the player's
// samples: those were handed to the audio thread when the file opened
// (audio/engine.js).
//
// The beat model's input is made one 30 s window at a time, so the model
// can start on the first window while the next ones are being prepared.
// Each window's samples are mixed to mono, resampled to 22,050 Hz
// (core/resample.js) and turned into its frames of the log-mel spectrogram
// (core/melspec.js): exactly the frames the whole track's spectrogram has
// there (core/beat-this.js windowSource, createWindowSpectrogram). Two ways:
//   - in the order the page asks for them (the cursor's first), each
//     decoded on its own from a little before it (the decoder warms up,
//     the resampler too). Only for files whose timestamps say exactly
//     where a decoder started in the middle is (`exact`: MP3, MP4/M4A,
//     WAV, FLAC; measured);
//   - in a WebM, Matroska or Ogg file they can be a few samples off (1–3
//     ms for Opus and Vorbis, enough to move some beats by a frame), so
//     there the whole track is decoded once from the start, where the
//     samples are counted, and each window is sent as soon as it's done,
//     in order ("stream").
//
// For when the model can't run, it also gives the simple beat finder's
// answer (core/beats.js), from one pass over the whole track.
//
// Messages:
//   page → { type: "open", media }  (a File, or { name, url }: core/media.js)
//   ←      { type: "info", duration, sampleRate, frames, exact }
//          frames: the whole track's spectrogram frames (core/beat-this.js framesFor)
//   page → { type: "window", start }  a window's first frame (core/beat-this.js
//          windowStarts); only when `exact`
//   ←      { type: "window", start, spect }  its frames × 128 values, from
//          frame max(start, 0)
//   page → { type: "stream", starts }  every window, in order of `starts`
//   ←      { type: "window", start, spect } … one by one, then { type: "streamed" }
//   page → { type: "simple" }
//   ←      { type: "progress", fraction } …  (at most every 100 ms)
//   ←      { type: "simple", beats, bpm }  times in seconds from the track's
//          first sample, as the player counts
// or at any point ← { type: "error", kind, message }, kind as in decode-worker.js
import {
  AudioSampleSink,
  FlacInputFormat,
  IsobmffInputFormat,
  Mp3InputFormat,
  WaveInputFormat,
} from "../../node_modules/mediabunny/dist/bundles/mediabunny.mjs";
import { CONFIG } from "../config.js";
import { createWindowSpectrogram, framesFor, windowSource } from "../core/beat-this.js";
import { createOnsetDetector, detectBeats } from "../core/beats.js";
import { DecodeError, openTrack } from "./open-track.js";

const scope = /** @type {any} */ (self);

let opened = null; // the track (open-track.js), and its `frames`

// Containers whose timestamps place a decoder started mid-stream exactly
// (measured with MP3, AAC in MP4, WAV and FLAC; Opus in WebM and Vorbis in
// Ogg were 1–3 ms off, AAC in Matroska up to 0.7 ms).
const EXACT_FORMATS = [Mp3InputFormat, IsobmffInputFormat, WaveInputFormat, FlacInputFormat];

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
  const format = await track.input.getFormat();
  const exact = EXACT_FORMATS.some((Format) => format instanceof Format);
  opened = { ...track, frames };
  return { duration: track.duration, sampleRate: track.sampleRate, frames, exact };
}

async function prepareWindow(start) {
  const source = windowSource(start, opened.frames, opened.sampleRate);
  const spectrogram = createWindowSpectrogram(source, opened.sampleRate);
  await eachMono(opened, source.inFrom, source.inTo, CONFIG.audio.parallel.preRoll, (mono) => spectrogram.push(mono));
  return spectrogram.finish();
}

// Every window of `starts`, from one decode of the whole track: each
// window's spectrogram is fed the samples it needs as they go by (two at
// once where windows overlap), and sent when it has them all.
async function stream(starts) {
  const { frames, sampleRate } = opened;
  const sources = starts.map((start) => ({ start, ...windowSource(start, frames, sampleRate) }));
  sources.sort((a, b) => a.inFrom - b.inFrom);
  const open = [];
  let next = 0;
  const send = ({ start, spectrogram }) => {
    const spect = spectrogram.finish();
    scope.postMessage({ type: "window", start, spect }, [spect.buffer]);
  };
  const begin = (source) => ({ ...source, spectrogram: createWindowSpectrogram(source, sampleRate) });
  await eachMono(opened, 0, Infinity, 0, (mono, at) => {
    const end = at + mono.length;
    while (next < sources.length && sources[next].inFrom < end) open.push(begin(sources[next++]));
    for (const window of open) {
      const from = Math.max(0, window.inFrom - at);
      const to = Math.min(mono.length, window.inTo - at);
      if (to > from) window.spectrogram.push(mono.subarray(from, to));
    }
    for (let i = 0; i < open.length;) {
      if (!open[i].atEnd && end >= open[i].inTo) send(open.splice(i, 1)[0]);
      else i++;
    }
  });
  // The last window (it runs to the end), and any the track ended before.
  for (const window of open) send(window);
  while (next < sources.length) send(begin(sources[next++]));
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
    } else if (data.type === "stream") {
      await stream(data.starts);
      scope.postMessage({ type: "streamed" });
    } else if (data.type === "simple") {
      const { beats, bpm } = await simple();
      scope.postMessage({ type: "simple", beats, bpm }, [beats.buffer]);
    }
  } catch (error) {
    const kind = error instanceof DecodeError ? error.kind : error instanceof RangeError ? "out-of-memory" : "failed";
    scope.postMessage({ type: "error", kind, message: String(error?.message ?? error) });
  }
};
