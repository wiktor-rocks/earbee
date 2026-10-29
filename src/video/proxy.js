import { CONFIG } from "../config.js";
import { EPSILON, covers, keepsFrame, nextRange, reachedSoon } from "./proxy-plan.js";

// Low-resolution proxy of one video (see CONFIG.video.proxy). Built from
// the source with WebCodecs, kept in memory as encoded chunks, and read
// back with its own small decoder.
//   build(isBusy)    builds the whole proxy; pauses while isBusy() is true
//   frameAt(time)    → VideoFrame for `time` (caller closes it), or null if
//                    nothing is built there (a builder goes there next) or
//                    it is the frame last returned
//   builtAt(time)    whether the proxy has the frame for `time`
//   built()          what is built so far: [start, end] pairs, in seconds
//   progress()       the same as shares of the video, 0…1, and whether all
//                    of it is built: { parts, complete }, or null if its
//                    length isn't known
//   dispose()        stops building and frees everything
// `makeSourceSink()` makes a VideoSampleSink of the video (each reader
// decodes on its own); `duration` is its length in seconds. `onProgress`
// (optional) is called whenever built() has grown.
//
// Where nothing is built yet, frameAt answers null and the page waits for
// the exact frame (marked as loading): nothing from elsewhere stands in,
// as a frame from seconds before would look like a wrong one.
//
// The proxy is built by up to `builders` at once, each re-encoding a
// stretch of the video (see proxy-plan.js for which). A second builder
// takes the second half of the first one's part, and so on. A frame asked
// for where nothing is built yet moves a builder there (starting a little
// before it, so small steps back are covered too), and the gaps left
// behind are filled afterwards.
// The chunks are kept in runs: stretches built in one go, each starting
// with a keyframe, so decoding never crosses from one run into another.
// Runs that come to touch are joined.
export function createVideoProxy({ track, makeSourceSink, duration, onProgress = () => {} }) {
  const { width, maxFps, keyframeInterval, bitrate, leadSeconds } = CONFIG.video.proxy;
  // Even dimensions keep every encoder happy.
  const height = 2 * Math.max(1, Math.round((width * track.displayHeight) / track.displayWidth / 2));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const known = Number.isFinite(duration) && duration > 0; // the length (else Infinity below)
  if (!known) duration = Infinity;

  /**
   * `first`: it starts at the start of the video; `last`: it reaches the end.
   * `from`: where its building started; `coverTo`: building it went on to
   * there (no frames between its last one and that).
   * @typedef {{ time: number, end: number, key: boolean, chunk: EncodedVideoChunk }} Chunk
   * @typedef {{ chunks: Chunk[], first: boolean, last: boolean, from: number, coverTo?: number }} Run
   * @typedef {{ from: number, to: number, lower: number, at: number, run: Run }} Job
   */
  /** @type {Run[]} */
  const runs = []; // in time order, never overlapping, never empty
  const blanks = []; // [from, to): built, but no frames there
  /** @type {Set<Job>} */
  const jobs = new Set(); // what each builder is building
  let decoderConfig = null;
  let disposed = false;
  const encoders = new Set(); // every one encoding now
  const readers = new Set(); // and the sample iterators feeding them
  let wanted = null; // a time asked for where nothing is built (latest wins)
  let wantedAt = 0; // performance.now() when it was asked for
  // Building moves only once the asking has settled: while a drag still
  // goes on, each move would restart decoding at a keyframe for a frame
  // or two.
  const SETTLE_MS = 150;

  const runStart = (run) => run.chunks[0].time;
  const runEnd = (run) => Math.max(run.chunks.at(-1).end, run.coverTo ?? -Infinity);

  // The run that has the frame shown at `time`, if any.
  const runAt = (time) =>
    runs.find((run) => covers({ start: runStart(run), end: runEnd(run), first: run.first, last: run.last }, time));

  const built = () => runs.map((run) => [runStart(run), runEnd(run)]);

  const progress = () =>
    known
      ? {
          parts: runs.map((run) => [
            run.first ? 0 : Math.min(1, runStart(run) / duration),
            run.last ? 1 : Math.min(1, runEnd(run) / duration),
          ]),
          complete: runs.length === 1 && runs[0].first && runs[0].last,
        }
      : null;

  async function pickCodec() {
    for (const codec of ["vp8", "vp09.00.10.08", "avc1.42001f"]) {
      const config = { codec, width, height, bitrate, framerate: maxFps };
      const [encode, decode] = await Promise.all([
        VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false })),
        VideoDecoder.isConfigSupported({ codec, codedWidth: width, codedHeight: height }).catch(() => ({
          supported: false,
        })),
      ]);
      if (encode.supported && decode.supported) return codec;
    }
    return null;
  }

  // An encoder for one stretch of building; closed (and forgotten) by close().
  function openEncoder(output, config) {
    const encoder = new VideoEncoder({ output, error: (error) => console.warn("Proxy encoder failed:", error) });
    encoder.configure({ width, height, latencyMode: "realtime", ...config });
    encoders.add(encoder);
    return encoder;
  }

  function closeEncoder(encoder) {
    encoders.delete(encoder);
    if (encoder.state !== "closed") encoder.close();
  }

  // Waits while the sharp decoder works or the encoder has enough to do,
  // and now and then anyway, so the page stays responsive.
  async function giveWay(encoder, count) {
    while (encoder.encodeQueueSize > 4 && !disposed) await sleep(1);
    while (isBusy() && !disposed) await sleep(5);
    if (count % 8 === 0) await sleep(0);
  }

  const scaled = new OffscreenCanvas(width, height);
  const scaledContext = scaled.getContext("2d");

  // The sample, scaled down to the proxy's size (the caller closes it).
  function scale(sample) {
    sample.drawWithFit(scaledContext, { fit: "fill" }); // also applies rotation
    return new VideoFrame(scaled, {
      timestamp: Math.round(sample.timestamp * 1e6),
      duration: Math.round(Math.max(sample.duration, 1 / maxFps) * 1e6),
    });
  }

  /* ---------- Building the proxy ---------- */

  const planRuns = () => [
    ...runs.map((run) => ({ start: runStart(run), end: runEnd(run), first: run.first, last: run.last })),
    ...blanks.map(([from, to]) => ({ start: from, end: to, first: false, last: to === Infinity })),
  ];
  const planJob = (job) => ({ from: job.from, to: job.to, at: job.at });

  // Gives `job` what to build next (see proxy-plan.js), with `focus` (a
  // time asked for) first. Returns false when there's nothing left.
  function claim(job, focus) {
    jobs.delete(job);
    const others = [...jobs];
    const range = nextRange(planRuns(), others.map(planJob), focus, { duration, leadSeconds });
    if (!range) return false;
    if (range.split >= 0) others[range.split].to = range.from;
    // The run the new frames continue (not one another builder still adds to).
    let after = range.after >= 0 && range.after < runs.length ? runs[range.after] : null;
    if (others.some((other) => other.run === after)) after = null;
    job.from = range.from;
    job.to = range.to;
    job.lower = range.lower;
    job.at = range.from;
    job.run = after ?? { chunks: [], first: range.from <= 0, last: false, from: range.from };
    jobs.add(job);
    return true;
  }

  // `next` directly follows `run`: one run from now on.
  function join(run, next) {
    run.chunks = run.chunks.concat(next.chunks);
    run.last = next.last;
    run.coverTo = next.coverTo;
    runs.splice(runs.indexOf(next), 1);
    for (const job of jobs) if (job.run === next) job.run = run; // builds on in the joined run
    if (readRun === next) readRun = null; // its chunks moved
  }

  // `job` built everything up to its `to`: ties up its run with what
  // follows.
  function reachedEnd(job) {
    const { run, lower, to } = job;
    const hasFrames = runs.includes(run);
    if (!hasFrames) blanks.push([lower, to]);
    // Without frames of its own, the run before (if it ends right there)
    // goes on until `to` instead.
    const target = hasFrames ? run : runs.find((other) => Math.abs(runEnd(other) - lower) < EPSILON);
    if (!Number.isFinite(to)) {
      if (target) target.last = true;
      return;
    }
    if (target) target.coverTo = Math.max(target.coverTo ?? -Infinity, to);
    // Who starts at `to`: a builder whose run has no frames yet builds on
    // in this one; a run already there is joined.
    const nextJob = [...jobs].find((other) => other !== job && other.from === to && !runs.includes(other.run));
    const next = runs.find(
      (other) => other !== target && (other.from === to || Math.abs(runStart(other) - to) < EPSILON),
    );
    if (target && nextJob) nextJob.run = target;
    else if (target && next) join(target, next);
    else if (next && lower <= 0) next.first = true;
  }

  // Builds job's range (until done, or asked for somewhere else). Returns
  // the time to go to next (or null), or false if it can't go on.
  async function buildRange(codec, sink, job) {
    const encoder = openEncoder(
      (chunk, metadata) => {
        if (disposed) return;
        if (metadata?.decoderConfig) decoderConfig = metadata.decoderConfig;
        const time = chunk.timestamp / 1e6;
        const length = (chunk.duration ?? 1e6 / maxFps) / 1e6;
        const { run } = job; // may have been joined into another meanwhile
        run.chunks.push({ time, end: time + length, key: chunk.type === "key", chunk });
        if (!runs.includes(run)) {
          const index = runs.findIndex((other) => runStart(other) > time);
          runs.splice(index < 0 ? runs.length : index, 0, run);
        }
      },
      { codec, bitrate, framerate: maxFps },
    );

    let nextTime = job.lower; // frames before this are built already
    let count = 0;
    let focus = null; // where to go instead
    let reportedAt = performance.now();
    const reader = sink.samples(job.from, Number.isFinite(job.to) ? job.to : undefined);
    readers.add(reader);
    try {
      for await (const sample of reader) {
        try {
          if (disposed) return false;
          if (sample.timestamp >= job.to - EPSILON) break; // `to` may have moved closer meanwhile
          if (keepsFrame(sample.timestamp, nextTime, sample.duration)) {
            const frame = scale(sample);
            // Every range starts with a keyframe, so runs decode on their own.
            encoder.encode(frame, { keyFrame: count % keyframeInterval === 0 });
            frame.close();
            count++;
            nextTime = sample.timestamp + 1 / maxFps;
            job.at = nextTime;
          }
        } finally {
          sample.close();
        }
        await giveWay(encoder, count);
        if (performance.now() - reportedAt > 1000 && runs.includes(job.run)) {
          reportedAt = performance.now();
          onProgress();
        }
        // Asked for somewhere else: go there, unless some builder reaches
        // it soon.
        if (wanted !== null && performance.now() - wantedAt >= SETTLE_MS) {
          const time = wanted;
          wanted = null;
          if (!runAt(time) && !reachedSoon([...jobs].map(planJob), time, leadSeconds)) {
            focus = time;
            break;
          }
        }
      }
      if (disposed) return false;
      await encoder.flush();
    } finally {
      readers.delete(reader);
      closeEncoder(encoder);
    }
    if (disposed) return false;
    if (focus === null) reachedEnd(job);
    onProgress();
    return focus;
  }

  async function builder(codec) {
    const sink = makeSourceSink();
    /** @type {Job} */
    const job = { from: 0, to: 0, lower: 0, at: 0, run: null };
    let focus = null;
    while (!disposed && claim(job, focus ?? takeWanted())) {
      focus = await buildRange(codec, sink, job);
      if (focus === false) break;
    }
    jobs.delete(job);
  }

  function takeWanted() {
    const time = wanted;
    wanted = null;
    return time;
  }

  /** @type {() => boolean} */
  let isBusy = () => false;

  async function build(busy) {
    isBusy = busy;
    const codec = await pickCodec();
    if (!codec) throw new Error("No video encoder available for the proxy.");
    const startedAt = performance.now();

    // Splitting needs the length; without it, one builder front to back.
    const most = known ? CONFIG.video.proxy.builders : 1;
    const count = Math.max(1, Math.min(most, Math.floor(navigator.hardwareConcurrency / 2)));
    await Promise.all(Array.from({ length: count }, () => builder(codec)));
    if (disposed) return;

    const chunks = runs.flatMap((run) => run.chunks);
    const megabytes = chunks.reduce((sum, { chunk }) => sum + chunk.byteLength, 0) / 1024 ** 2;
    console.debug(
      `Video proxy: ${chunks.length} frames (${codec}, ${width}×${height}, ${megabytes.toFixed(1)} MB) ` +
        `in ${Math.round(performance.now() - startedAt)} ms by ${count} builders`,
    );
  }

  /* ---------- Reading ---------- */

  let decoder = null;
  /** @type {Run | null} */
  let readRun = null; // the run the decoder is in
  let nextIndex = -1; // next chunk of readRun the decoder expects, when decoding in order
  const waiting = new Map(); // chunk timestamp (µs) → resolve(frame)

  function onOutput(frame) {
    const resolve = waiting.get(frame.timestamp);
    if (resolve) {
      waiting.delete(frame.timestamp);
      resolve(frame);
    } else {
      frame.close(); // a frame decoded only on the way to the wanted one
    }
  }

  function restartDecoder(run) {
    if (!decoder || decoder.state === "closed") {
      const own = new VideoDecoder({
        output: onOutput,
        error: (error) => {
          console.warn("Proxy decoder failed:", error);
          if (decoder === own) decoder = null; // not a newer one
        },
      });
      decoder = own;
    } else {
      decoder.reset();
    }
    decoder.configure(decoderConfig);
    for (const resolve of waiting.values()) resolve(null);
    waiting.clear();
    readRun = run;
    nextIndex = -1;
  }

  // Index of the chunk shown at `time` (the last one starting at or before
  // it; the first if `time` is before it, in the run at the very start).
  function indexAt(chunks, time) {
    let low = 0;
    let high = chunks.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (chunks[middle].time <= time) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  function keyIndexBefore(chunks, index) {
    let i = index;
    while (i > 0 && !chunks[i].key) i--;
    return i;
  }

  async function frameAt(time) {
    if (disposed) return null;
    const run = runAt(time);
    if (!run) {
      wanted = time; // build here next
      wantedAt = performance.now();
      return null;
    }
    if (!decoderConfig) return null;
    const { chunks } = run;
    const index = indexAt(chunks, time);
    const inOrder = decoder && run === readRun;
    if (inOrder && index === nextIndex - 1) return null; // already the latest frame

    // Continue in order when possible; otherwise start at the keyframe.
    const continuing = inOrder && nextIndex >= 0 && nextIndex <= index && keyIndexBefore(chunks, index) < nextIndex;
    if (!continuing) restartDecoder(run);
    const first = continuing ? nextIndex : keyIndexBefore(chunks, index);

    for (let i = first; i < index; i++) decoder.decode(chunks[i].chunk);
    const wantedChunk = chunks[index].chunk;
    const frame = new Promise((resolve) => waiting.set(wantedChunk.timestamp, resolve));
    decoder.decode(wantedChunk);
    nextIndex = index + 1;

    // A decoder that holds frames back would never answer; give up quickly,
    // and start over at the keyframe next time (the frame may still come).
    const timeout = sleep(250).then(() => {
      if (waiting.delete(wantedChunk.timestamp)) nextIndex = -1;
      return null;
    });
    return Promise.race([frame, timeout]);
  }

  function dispose() {
    disposed = true;
    for (const resolve of waiting.values()) resolve(null);
    waiting.clear();
    if (decoder && decoder.state !== "closed") decoder.close();
    decoder = null;
    // Ended here too, before the file is disposed: a read of a disposed
    // file throws, which ends the loop without ending the reader, and its
    // decoder would stay open.
    for (const reader of readers) reader.return().catch(() => {});
    readers.clear();
    for (const encoder of encoders) closeEncoder(encoder);
    readRun = null;
    runs.length = 0;
  }

  return {
    build,
    frameAt,
    builtAt: (time) => runAt(time) !== undefined,
    built,
    progress,
    dispose,
  };
}
