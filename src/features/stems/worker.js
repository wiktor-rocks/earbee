// Stems (src/features/stems/): the page's side of separating one song, and
// of bringing back a project's stems, off its main thread (a module
// Worker).
//
// Separating: it decodes the file again (the player's samples went to the
// audio thread when it opened), at 44.1 kHz in stereo (what the model
// hears; core/resample.js for other rates), and streams it to the stem
// process (electron/stems/process.js) over the port it's given. The process
// does the part wanted first (the loop), then the rest, and sends each
// piece back as it's done; here each piece is turned back to the track's
// rate in 16 bits, kept in this worker's copy of the stems, and handed over
// at once to be played. At the end (or Stop) the copy goes to the page,
// which has a few of these workers encode it as Opus (opus.js) for saving
// in a project. The song and its stems never pass through the page's main
// thread on their way to the player.
//
// Loading: a project's Opus stems decoded back to the same form.
//
// Stems here are { id: [left, right] } Int16Arrays at the track's rate,
// from its first sample, each sample × SCALE (CONFIG.stems.headroom); the
// parts separated, `covered`, are spans of those samples (spans.js).
//
//   page → { type: "separate", media, port, want: { from, to }, covered, stems? }
//          media: a File, or { name, url } (core/media.js); want: seconds;
//          stems and covered: an earlier run's, to carry on from (transferred)
//   ←      { type: "progress", stage: "decode" | "separate", fraction, part?, wanted? } …
//          fraction: of the whole song; part: of the part wanted; wanted: that's done
//   ←      { type: "begin", sampleRate, length }   the stems' rate and length
//   ←      { type: "piece", from, stems, covered } stems from sample `from` (transferred)
//   page → { type: "want", from, to }               seconds: the loop moved
//   page → { type: "snapshot" }
//   ←      { type: "snapshot", stems, covered }     copies of the stems so far
//   page → { type: "stop" }                         no more: ends with what's done
//   ←      { type: "done", stems, covered, levels, error } the stems (transferred);
//          error: why the process stopped early, if it did
//   page → { type: "encode", stems, sampleRate }    some stems (transferred)
//   ←      { type: "progress", stage: "encode", fraction } …, then { type: "done", audio, stems }
//          their Opus bytes, and the stems back
//   page → { type: "load", audio: { [id]: bytes }, sampleRate, length }
//   ←      { type: "progress", stage: "load", fraction } …
//   ←      { type: "stems", sampleRate, length, stems: { [id]: { scale, channels, level } } }
//          to play: each channel an Int16Array (× scale: the samples), level its loudness
//   ←      { type: "done", audio, stems }  each stem's Opus bytes, for the project, and its samples
//   ←      { type: "error", message }
import { AudioSampleSink } from "../../../node_modules/mediabunny/dist/bundles/mediabunny.mjs";
import { CONFIG } from "../../config.js";
import { createResampler, resampleRatio } from "../../core/resample.js";
import { openTrack } from "../../audio/open-track.js";
import { decodeStem, encodeStem } from "./opus.js";
import { addSpan, scaleSpans } from "./spans.js";

const scope = /** @type {any} */ (self);
const { sampleRate: RATE, chunk: CHUNK } = CONFIG.stems;
const SCALE = CONFIG.stems.headroom / 32767;

// Progress at most this often, so the page isn't flooded.
const PROGRESS_MS = 100;

function progressReporter(stage) {
  let last = 0;
  return (fraction, more = {}) => {
    const now = performance.now();
    if (now - last < PROGRESS_MS && fraction < 1) return;
    last = now;
    scope.postMessage({ type: "progress", stage, fraction, ...more });
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

// The samples at the track's rate over [from, to) (its samples) from a
// piece of the process's (`samples`, at RATE, from `start`), resampled on
// its own: the piece carries enough either side for the filter.
function resamplePiece(samples, start, from, to, rate) {
  const { up, down } = resampleRatio(RATE, rate, CONFIG.stems.resampleZeroCrossings);
  if (up === down) return samples.subarray(from - start, to - start);
  // The resampler starts at a multiple of `down`, with silence before the piece.
  const first = Math.floor(start / down) * down;
  const resampler = createResampler(RATE, rate, CONFIG.stems.resampleZeroCrossings);
  resampler.push(new Float32Array(start - first));
  resampler.push(samples);
  resampler.finish();
  const out = resampler.take();
  const offset = (first * up) / down; // the track sample out[0] is
  return out.subarray(from - offset, to - offset);
}

// Writes float samples into a stem's channel from `at`, in 16 bits.
function write(channel, at, samples) {
  const end = Math.min(channel.length, at + samples.length);
  for (let i = at; i < end; i++) channel[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i - at] / SCALE)));
}

// What this worker is separating: its copy of the stems, what's covered,
// and the process's port.
let separating = null;
let stopSoon = false; // Stop came while the song was still being read

// Hands the stems over and ends: at the end, on Stop, or when the process
// failed (`error`, its message: what was done until then still plays).
function finish(error = null) {
  if (!separating) return;
  const { port, stems, covered } = separating;
  separating = null;
  port.postMessage({ type: "close" });
  port.close();
  const levels = Object.fromEntries(
    Object.entries(stems).map(([id, channels]) => [id, level({ scale: SCALE, channels })]),
  );
  scope.postMessage({ type: "done", stems, covered, levels, error }, buffersOf(stems));
}

// Separates `media`: sends it to the process, then takes its pieces as they
// come, until it's all done (finish) or stopped. `previous`: an earlier
// run's stems and covered, to carry on from.
async function separateTrack({ media, port, want, covered = [], stems: previous }) {
  const { length, sampleRate: rate } = await sendTrack(media, port);
  const { up, down } = resampleRatio(RATE, rate, CONFIG.stems.resampleZeroCrossings);
  const trackLength = Math.ceil((length * up) / down);
  // The track's samples → the process's (at RATE), and back.
  const toRate = (from, to) => ({ from: Math.round(from * RATE), to: Math.round(to * RATE) });
  const toTrack = (sample) => Math.min(trackLength, Math.ceil((sample * up) / down));
  const ids = CONFIG.stems.list.map(({ id }) => id);
  const stems =
    previous ?? Object.fromEntries(ids.map((id) => [id, [new Int16Array(trackLength), new Int16Array(trackLength)]]));
  separating = { port, stems, covered, toRate };
  scope.postMessage({ type: "begin", sampleRate: rate, length: trackLength });
  if (stopSoon) return finish();

  const progress = progressReporter("separate");
  let wanted = false;
  port.onmessage = ({ data }) => {
    if (!separating) return;
    if (data.type === "progress") {
      const fraction = data.total ? data.done / data.total : 0;
      // The part wanted being done is news at once; the rest, at most every PROGRESS_MS.
      if (data.wanted && !wanted) {
        scope.postMessage({ type: "progress", stage: "separate", fraction, part: 1, wanted: true });
      }
      wanted = data.wanted;
      progress(fraction, { part: data.part, wanted });
    } else if (data.type === "piece") {
      const from = toTrack(data.from);
      const to = data.to >= length ? trackLength : toTrack(data.to);
      if (!(from < to)) return;
      const piece = {};
      for (const [s, id] of data.names.entries()) {
        if (!stems[id]) continue;
        piece[id] = [0, 1].map((c) => {
          write(stems[id][c], from, resamplePiece(data.samples[s * 2 + c], data.start, from, to, rate));
          return stems[id][c].slice(from, to);
        });
      }
      separating.covered = addSpan(separating.covered, from, to);
      scope.postMessage({ type: "piece", from, stems: piece, covered: separating.covered }, buffersOf(piece));
    } else if (data.type === "done") finish();
    else if (data.type === "error") finish(data.message);
  };
  port.postMessage({
    type: "separate",
    length,
    want: toRate(want.from, want.to),
    covered: scaleSpans(covered, down / up),
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

// A stem in 16 bits (SCALE). A plain loop: from() with a function takes
// seconds over a song's samples (measured: 3 s a stem).
/** @param {Float32Array[]} channels */
function quantize(channels) {
  return {
    scale: SCALE,
    channels: channels.map((channel) => {
      const out = new Int16Array(channel.length);
      write(out, 0, channel);
      return out;
    }),
  };
}

// A stem's samples back from its 16 bits.
/** @param {Int16Array[]} channels */
function unquantize(channels) {
  return channels.map((channel) => {
    const out = new Float32Array(channel.length);
    for (let i = 0; i < channel.length; i++) out[i] = channel[i] * SCALE;
    return out;
  });
}

// Each stem as Opus, from its 16 bits.
async function encodeAll(stems, rate) {
  const progress = progressReporter("encode");
  const audio = {};
  const ids = Object.keys(stems);
  for (const [index, id] of ids.entries()) {
    audio[id] = await encodeStem(unquantize(stems[id]), rate, CONFIG.stems.bitrate);
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

// Hands copies of the stems over to be played, their samples transferred;
// the worker keeps its own (for the page, to carry on separating or to
// encode).
function handOver({ sampleRate, length, stems }) {
  const copies = Object.fromEntries(
    Object.entries(stems).map(([id, { scale, channels }]) => {
      const stem = { scale, channels: channels.map((channel) => channel.slice()) };
      return [id, { ...stem, level: level(stem) }];
    }),
  );
  const buffers = Object.values(copies).flatMap((stem) => stem.channels.map((channel) => channel.buffer));
  scope.postMessage({ type: "stems", sampleRate, length, stems: copies }, buffers);
}

const buffersOf = (stems) => Object.values(stems).flatMap((channels) => channels.map((channel) => channel.buffer));
const fail = (error) => scope.postMessage({ type: "error", message: String(error?.message ?? error) });

scope.addEventListener("message", async ({ data }) => {
  if (data?.type === "separate") {
    try {
      await separateTrack(data);
    } catch (error) {
      separating = null;
      data.port.close();
      fail(error);
    }
  } else if (data?.type === "want") {
    if (separating) separating.port.postMessage({ type: "want", ...separating.toRate(data.from, data.to) });
  } else if (data?.type === "snapshot") {
    if (separating) scope.postMessage({ type: "snapshot", stems: separating.stems, covered: separating.covered });
  } else if (data?.type === "stop") {
    if (separating) finish();
    else stopSoon = true;
  } else if (data?.type === "encode") {
    try {
      const audio = await encodeAll(data.stems, data.sampleRate);
      scope.postMessage({ type: "done", audio, stems: data.stems }, buffersOf(data.stems));
    } catch (error) {
      fail(error);
    }
  } else if (data?.type === "load") {
    const { audio, sampleRate, length } = data;
    try {
      const decoded = await decodeAll(audio, sampleRate, length);
      handOver({ sampleRate, length, stems: decoded });
      const stems = Object.fromEntries(Object.entries(decoded).map(([id, stem]) => [id, stem.channels]));
      scope.postMessage({ type: "done", audio, stems }, buffersOf(stems));
    } catch (error) {
      fail(error);
    }
  }
});
