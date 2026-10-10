// Decodes the audio of one file, or one part of it, chunk by chunk, off
// the page's main thread (a module Worker; see decoder.js for the page
// side, which runs several of these on one file in parallel).
//
// Messages, in order:
//   page → { type: "open", media }   (a File, or { name, url }: core/media.js)
//   ←      { type: "info", duration, sampleRate, channels }
//   page → { type: "decode", peakFactor, from, to, preRoll }
//          (or terminates the worker): frames [from, to) of the track,
//          counted from its first sample; `to` Infinity = to the end
//   ←      { type: "progress", written } …  (at most every 100 ms)
//   ←      { type: "done", channels, levels, written }
// or at any point ← { type: "error", kind, message }, kind being
//   "cannot-decode"  the format or codec can't be read here
//   "no-audio"       the file has no audio track
//   "out-of-memory"  the decoded track doesn't fit in memory
//   "failed"         anything else
//
// The file is read in pieces (BlobSource or UrlSource), never whole, and the
// samples go straight into one Float32Array per channel at the file's own
// rate. Both are what makes long files work: decodeAudioData needed about
// twice the decoded size at its peak, and failed outright on long AAC files.
//
// A part that starts later than the beginning starts decoding `preRoll`
// seconds before `from` (a decoder started mid-stream needs a little audio
// to warm up; Mediabunny starts exactly where asked) and drops what comes
// before `from`. Where `from` is comes from the timestamps, which can be a
// few frames off; decoder.js corrects that when it joins the parts.
import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  Input,
  UrlSource,
} from "../../node_modules/mediabunny/dist/bundles/mediabunny.mjs";
import { downsampleLevels, mediaSource } from "../core/media.js";

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

async function open(media) {
  const input = new Input({ formats: ALL_FORMATS, source: mediaSource(media, { BlobSource, UrlSource }) });
  let track;
  try {
    track = await input.getPrimaryAudioTrack();
  } catch (error) {
    throw new DecodeError("cannot-decode", String(error?.message ?? error));
  }
  if (!track) throw new DecodeError("no-audio", "no audio track");
  if (!(await track.canDecode())) throw new DecodeError("cannot-decode", `can't decode ${track.codec ?? "its codec"}`);

  const [end, first] = await Promise.all([track.computeDuration(), track.getFirstTimestamp()]);
  return {
    input,
    track,
    first,
    duration: end - first,
    sampleRate: track.sampleRate,
    channels: track.numberOfChannels,
  };
}

async function decode({ track, first, duration, sampleRate, channels }, { peakFactor, from, to, preRoll }) {
  const wanted = Number.isFinite(to) ? to - from : Infinity;
  const capacity = Number.isFinite(wanted) ? wanted : Math.ceil(duration * sampleRate) - from + sampleRate;
  const store = createChannelStore(channels, Math.max(1, capacity));
  let started = from === 0; // the first part takes everything from the start
  let reportedAt = -Infinity; // the first chunk always reports

  const start = from === 0 ? first : Math.max(first, first + from / sampleRate - preRoll);
  for await (const sample of new AudioSampleSink(track).samples(start)) {
    let full;
    try {
      const frames = sample.numberOfFrames;
      let skip = 0;
      if (!started) {
        // Warming up: drop what comes before `from`.
        const position = Math.round((sample.timestamp - first) * sampleRate);
        if (position + frames <= from) continue;
        skip = Math.max(0, from - position);
        started = true;
      }
      const count = Math.min(frames - skip, wanted - store.written);
      const at = store.reserve(count);
      for (let c = 0; c < channels; c++) {
        // A mono chunk in a stereo track (rare) fills every channel.
        const plane = Math.min(c, sample.numberOfChannels - 1);
        const target = store.channel(c).subarray(at, at + count);
        sample.copyTo(target, { planeIndex: plane, format: "f32-planar", frameOffset: skip, frameCount: count });
      }
      full = store.written >= wanted;
    } finally {
      sample.close();
    }

    const now = performance.now();
    if (now - reportedAt > 100) {
      reportedAt = now;
      scope.postMessage({ type: "progress", written: store.written });
    }
    if (full) break; // also stops the decoder
  }

  // The waveform levels (peak and RMS) in one pass at the end: 0.7 s per hour, against 2–4 s for
  // computing them chunk by chunk (measured; the per-chunk bookkeeping
  // costs more than the loop itself).
  const decoded = store.finish();
  // Always new arrays, so they can be transferred alongside the samples.
  // They are small.
  const levels = decoded.map((samples) => downsampleLevels(samples, peakFactor));
  return { channels: decoded, levels, written: store.written };
}

let opened = null;

scope.onmessage = async ({ data }) => {
  try {
    if (data.type === "open") {
      opened = await open(data.media);
      const { duration, sampleRate, channels } = opened;
      scope.postMessage({ type: "info", duration, sampleRate, channels });
    } else if (data.type === "decode") {
      const result = await decode(opened, data);
      opened.input.dispose?.();
      scope.postMessage({ type: "done", ...result }, [
        ...result.channels.map((array) => array.buffer),
        ...result.levels.flatMap(({ peak, rms }) => [peak.buffer, rms.buffer]),
      ]);
    }
  } catch (error) {
    const kind = error instanceof DecodeError ? error.kind : error instanceof RangeError ? "out-of-memory" : "failed";
    scope.postMessage({ type: "error", kind, message: String(error?.message ?? error) });
  }
};
