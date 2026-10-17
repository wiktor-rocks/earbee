// Prepares one file for finding its beats, off the page's main thread (a
// module Worker; features/beats.js is the page side). It decodes the file
// again rather than use the player's samples: those were handed to the
// audio thread when the file opened (audio/engine.js).
//
// One pass over the sound, mixed to mono, makes both:
//   - the beat model's input: resampled to 22,050 Hz (core/resample.js)
//     and turned into a log-mel spectrogram (core/melspec.js); the page
//     has the model run on it (electron/beat-model.js);
//   - the simple beat finder's answer (core/beats.js), the fallback for
//     when the model can't run.
// Both are streamed chunk by chunk; only the spectrogram (128 values per
// 20 ms, ~6 MB for 4 minutes) and the onset envelope are kept.
//
// Messages:
//   page → { type: "prepare", media }  (a File, or { name, url }: core/media.js)
//   ←      { type: "progress", fraction } …  (at most every 100 ms)
//   ←      { type: "done", spect, frames, simple: { beats, bpm } }
//          spect: frames × 128 values (core/melspec.js); times are
//          seconds from the track's first sample, as the player counts
// or      { type: "error", kind, message }, kind as in decode-worker.js
import { AudioSampleSink } from "../../node_modules/mediabunny/dist/bundles/mediabunny.mjs";
import { createOnsetDetector, detectBeats } from "../core/beats.js";
import { createLogMelSpectrogram, MEL_RATE } from "../core/melspec.js";
import { createResampler } from "../core/resample.js";
import { DecodeError, openTrack } from "./open-track.js";

const scope = /** @type {any} */ (self);

async function prepare(media) {
  const { input, track, first, duration, sampleRate } = await openTrack(media);
  const onsets = createOnsetDetector(sampleRate);
  const resampler = createResampler(sampleRate, MEL_RATE);
  const spectrogram = createLogMelSpectrogram();
  let plane = new Float32Array(0);
  let mono = new Float32Array(0);
  let reportedAt = -Infinity;

  for await (const sample of new AudioSampleSink(track).samples(first)) {
    const frames = sample.numberOfFrames;
    const channels = sample.numberOfChannels;
    try {
      if (plane.length < frames) [plane, mono] = [new Float32Array(frames), new Float32Array(frames)];
      mono.fill(0, 0, frames);
      for (let c = 0; c < channels; c++) {
        sample.copyTo(plane, { planeIndex: c, format: "f32-planar" });
        for (let i = 0; i < frames; i++) mono[i] += plane[i] / channels;
      }
    } finally {
      sample.close();
    }
    const chunk = mono.subarray(0, frames);
    onsets.push(chunk);
    resampler.push(chunk);
    spectrogram.push(resampler.take());

    const now = performance.now();
    if (now - reportedAt > 100 && duration > 0) {
      reportedAt = now;
      scope.postMessage({ type: "progress", fraction: Math.min(1, (sample.timestamp - first) / duration) });
    }
  }
  input.dispose?.();

  resampler.finish();
  spectrogram.push(resampler.take());
  const { frames, data } = spectrogram.finish();
  const { envelope, frameRate } = onsets.finish();
  return { spect: data, frames, simple: detectBeats(envelope, frameRate) };
}

scope.onmessage = async ({ data }) => {
  if (data.type !== "prepare") return;
  try {
    const { spect, frames, simple } = await prepare(data.media);
    scope.postMessage({ type: "done", spect, frames, simple }, [spect.buffer, simple.beats.buffer]);
  } catch (error) {
    const kind = error instanceof DecodeError ? error.kind : error instanceof RangeError ? "out-of-memory" : "failed";
    scope.postMessage({ type: "error", kind, message: String(error?.message ?? error) });
  }
};
