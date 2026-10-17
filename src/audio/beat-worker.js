// Finds the beats of one file, off the page's main thread (a module
// Worker; features/beats.js is the page side). It decodes the file again
// rather than use the player's samples: those were handed to the audio
// thread when the file opened (audio/engine.js). The sound is mixed to
// mono and streamed through the onset detector (core/beats.js) chunk by
// chunk, so only the small onset envelope is ever kept.
//
// Messages:
//   page → { type: "detect", media }  (a File, or { name, url }: core/media.js)
//   ←      { type: "progress", fraction } …  (at most every 100 ms)
//   ←      { type: "done", beats, bpm }  (beats: seconds from the track's
//          first sample, as the player counts; none and bpm null if
//          there is no pulse)
// or      { type: "error", kind, message }, kind as in decode-worker.js
import { AudioSampleSink } from "../../node_modules/mediabunny/dist/bundles/mediabunny.mjs";
import { createOnsetDetector, detectBeats } from "../core/beats.js";
import { DecodeError, openTrack } from "./open-track.js";

const scope = /** @type {any} */ (self);

async function detect(media) {
  const { input, track, first, duration, sampleRate } = await openTrack(media);
  const detector = createOnsetDetector(sampleRate);
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
    detector.push(mono.subarray(0, frames));

    const now = performance.now();
    if (now - reportedAt > 100 && duration > 0) {
      reportedAt = now;
      scope.postMessage({ type: "progress", fraction: Math.min(1, (sample.timestamp - first) / duration) });
    }
  }
  input.dispose?.();

  const { envelope, frameRate } = detector.finish();
  return detectBeats(envelope, frameRate);
}

scope.onmessage = async ({ data }) => {
  if (data.type !== "detect") return;
  try {
    const { beats, bpm } = await detect(data.media);
    scope.postMessage({ type: "done", beats, bpm }, [beats.buffer]);
  } catch (error) {
    const kind = error instanceof DecodeError ? error.kind : error instanceof RangeError ? "out-of-memory" : "failed";
    scope.postMessage({ type: "error", kind, message: String(error?.message ?? error) });
  }
};
