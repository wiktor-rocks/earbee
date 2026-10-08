// Decodes the audio of one file, chunk by chunk, off the page's main
// thread (a module Worker; see decoder.js for the page side).
//
// Messages, in order:
//   page → { type: "open", file }
//   ←      { type: "info", duration, sampleRate, channels }
//   page → { type: "decode", peakFactor }   (or terminates the worker)
//   ←      { type: "progress", fraction } …  (at most every 100 ms)
//   ←      { type: "done", channels, peaks, sampleRate, duration }
// or at any point ← { type: "error", kind, message }, kind being
//   "cannot-decode"  the format or codec can't be read here
//   "no-audio"       the file has no audio track
//   "out-of-memory"  the decoded track doesn't fit in memory
//   "failed"         anything else
//
// The file is read in pieces (BlobSource), never whole, and the samples go
// straight into one Float32Array per channel at the file's own rate. Both
// are what makes long files work: decodeAudioData needed about twice the
// decoded size at its peak, and failed outright on long AAC files.
import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  Input,
} from "../../node_modules/mediabunny/dist/bundles/mediabunny.mjs";
import { downsamplePeaks } from "../core/peaks.js";

const scope = /** @type {any} */ (self);

class DecodeError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

// One Float32Array per channel; grows (by copying) if the track turns out
// longer than its reported duration.
function createChannelStore(channels, capacity) {
  let arrays = allocate(channels, capacity);
  let written = 0;

  function allocate(count, length) {
    try {
      return Array.from({ length: count }, () => new Float32Array(length));
    } catch (error) {
      if (error instanceof RangeError) throw new DecodeError("out-of-memory", error.message);
      throw error;
    }
  }

  return {
    // Space for `frames` more frames; returns where they start.
    reserve(frames) {
      if (written + frames > arrays[0].length) {
        const grown = allocate(channels, Math.ceil((written + frames) * 1.25));
        grown.forEach((array, c) => array.set(arrays[c].subarray(0, written)));
        arrays = grown;
      }
      const start = written;
      written += frames;
      return start;
    },
    channel: (c) => arrays[c],
    get written() {
      return written;
    },
    // The samples, without the unused end (the views keep their buffers).
    finish: () => arrays.map((array) => array.subarray(0, written)),
  };
}

async function open(file) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  let track;
  try {
    track = await input.getPrimaryAudioTrack();
  } catch (error) {
    throw new DecodeError("cannot-decode", String(error?.message ?? error));
  }
  if (!track) throw new DecodeError("no-audio", "no audio track");
  if (!(await track.canDecode())) throw new DecodeError("cannot-decode", `can't decode ${track.codec ?? "its codec"}`);

  const duration = await track.computeDuration();
  return { input, track, duration, sampleRate: track.sampleRate, channels: track.numberOfChannels };
}

async function decode({ track, duration, sampleRate, channels }, peakFactor) {
  const expected = Math.ceil(duration * sampleRate);
  const store = createChannelStore(channels, expected + sampleRate);
  let reportedAt = -Infinity; // the first chunk always reports

  for await (const sample of new AudioSampleSink(track).samples()) {
    try {
      const frames = sample.numberOfFrames;
      const start = store.reserve(frames);
      for (let c = 0; c < channels; c++) {
        // A mono chunk in a stereo track (rare) fills every channel.
        const plane = Math.min(c, sample.numberOfChannels - 1);
        const target = store.channel(c).subarray(start, start + frames);
        sample.copyTo(target, { planeIndex: plane, format: "f32-planar", frameCount: frames });
      }
    } finally {
      sample.close();
    }

    const now = performance.now();
    if (now - reportedAt > 100) {
      reportedAt = now;
      scope.postMessage({ type: "progress", fraction: Math.min(1, store.written / expected) });
    }
  }

  // The peaks in one pass at the end: 0.7 s per hour, against 2–4 s for
  // computing them chunk by chunk (measured; the per-chunk bookkeeping
  // costs more than the loop itself).
  const decoded = store.finish();
  // slice(): with a factor of 1 the peaks would be the samples themselves,
  // and one buffer can't be transferred twice. Peaks are small.
  const peaks = decoded.map((samples) => downsamplePeaks(samples, peakFactor).slice(0));
  return { channels: decoded, peaks, duration: store.written / sampleRate };
}

let opened = null;

scope.onmessage = async ({ data }) => {
  try {
    if (data.type === "open") {
      opened = await open(data.file);
      const { duration, sampleRate, channels } = opened;
      scope.postMessage({ type: "info", duration, sampleRate, channels });
    } else if (data.type === "decode") {
      const result = await decode(opened, data.peakFactor);
      opened.input.dispose?.();
      scope.postMessage({ type: "done", sampleRate: opened.sampleRate, ...result }, [
        ...result.channels.map((array) => array.buffer),
        ...result.peaks.map((array) => array.buffer),
      ]);
    }
  } catch (error) {
    const kind = error instanceof DecodeError ? error.kind : error instanceof RangeError ? "out-of-memory" : "failed";
    scope.postMessage({ type: "error", kind, message: String(error?.message ?? error) });
  }
};
