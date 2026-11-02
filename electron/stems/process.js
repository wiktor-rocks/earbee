// The stem model's utility process (started by index.js for one song):
// runs models/htdemucs-6s.onnx (its path is the first argument) on the
// native ONNX Runtime, through separate.js, and talks to the page's stems
// worker (src/features/stems/worker.js) directly, over the port it's given
// first: the song and its stems never pass through the main process.
//
// The part wanted (the loop) is separated first, then the rest, nearest it
// first; each segment's stems go back as soon as it's done, so they play
// there at once. Or only a part (the loop alone): then only the song
// around it is kept, and only the segments touching it are separated. All
// positions are samples at 44.1 kHz.
//
//   main → { type: "port" } with the port
//   page → { type: "part", from, to }                   (before the song) only this part
//   page → { type: "audio", channel, offset, samples }  the song at 44.1 kHz, in chunks
//   page → { type: "separate", length, want: { from, to }, covered }
//          all of it has come; `covered`: [[from, to], …] already separated
//          (an earlier run's), skipped where it can be
//   page → { type: "want", from, to }                   the loop moved: that next (not with a part)
//   ←      { type: "piece", from, to, start, names, samples }
//          the stems over [from, to): `samples` is each stem's left and
//          right, in `names` order, from `start`, with up to MARGIN samples
//          either side (to resample the piece on its own)
//   ←      { type: "progress", done, total, part, wanted }
//          segments done; part: how much of the part wanted is, wanted: all of it
//   ←      { type: "done" }                             every segment is (of the part)
//   ←      { type: "error", message }
//   page → { type: "close" }                            no more wanted: the process exits
//                                                       (index.js stops it if the page goes away)
//
// The song comes in chunks, so no message holds a whole song (its six
// stems are hundreds of MB), and only the blend around the segments still
// to do is kept here (separate.js, keepFor). Cancelling kills the process
// (index.js).
const fs = require("fs");
const os = require("os");
const { createSeparator, orderOutward, segmentSpan, segmentsFor, songStats, SEGMENT, STEMS } = require("./separate");

// Samples either side of a piece, beyond what it changed: enough for the
// page's resampler to make the piece's own samples exactly (its filter
// reaches a few dozen).
const MARGIN = 1024;
// A span counts as separated before if it's within this of one: the page
// gives them at the song's own rate, rounded.
const SLACK = 4;
// More threads stopped helping at 4 (measured: 8.6 s a segment on 1, 5.9
// on 2, 5.0 on 4, 4.9 on 6), and playback needs some CPU too.
const THREADS = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));
// All six, "other" too: a changed mix plays their sum (src/features/stems/).
const KEEP = STEMS;
// With a part, the song kept around it: a segment touching it reaches a
// segment beyond it, and its padding up to half a segment more.
const REACH = 2 * SEGMENT;

// Below normal priority, so separating gives way to playback, the video
// and drawing. Set before ONNX Runtime starts its threads, which take it
// on (see beat-model-process.js).
try {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
} catch (error) {
  console.warn("The stem model runs at normal priority:", error?.message ?? error);
}

async function createSession() {
  const ort = require("onnxruntime-node");
  const session = await ort.InferenceSession.create(fs.readFileSync(process.argv.at(-1)), {
    intraOpNumThreads: THREADS,
    executionProviders: ["cpu"],
    // The arena would keep a segment's working memory (about 2 GB) for
    // the whole song; without it, it goes back between segments (measured).
    enableCpuMemArena: false,
    // On, it crashes the process (SIGTRAP), as with the beat model.
    enableMemPattern: false,
    extra: { session: { intra_op: { allow_spinning: "0" }, inter_op: { allow_spinning: "0" } } },
  });
  return async (mix) => {
    const out = await session.run({ mix: new ort.Tensor("float32", mix, [1, 2, SEGMENT]) });
    return {
      spec: /** @type {Float32Array} */ (out.spec.data),
      wave: /** @type {Float32Array} */ (out.wave.data),
    };
  };
}

// Whether [from, to) is within the spans `covered` ([[from, to], …]).
const within = (covered, { from, to }) => covered.some(([start, end]) => start - SLACK <= from && to <= end + SLACK);

// `port`: the MessagePortMain the main process handed over.
function serve(port) {
  const chunks = [[], []]; // per channel: { offset, samples }, what's kept of the song
  const send = (message) => port.postMessage(message);
  let aim = null; // while running: points it at the part wanted next
  let only = null; // { from, to }: only this part, and the song kept from `keep.from` to `keep.to`
  // The normalising, added up as the song comes (both channels' chunks at
  // an offset, once both are here: they're cut alike).
  const stats = songStats();
  const unpaired = [new Map(), new Map()]; // per channel: offset → samples

  function take({ channel, offset, samples }) {
    const other = unpaired[1 - channel].get(offset);
    if (other) {
      unpaired[1 - channel].delete(offset);
      stats.add(channel === 0 ? samples : other, channel === 0 ? other : samples);
    } else unpaired[channel].set(offset, samples);
    if (!only) return chunks[channel].push({ offset, samples });
    // Only what's within reach of the part, copied (the chunk itself goes).
    const from = Math.max(offset, only.keep.from);
    const to = Math.min(offset + samples.length, only.keep.to);
    if (from < to) chunks[channel].push({ offset: from, samples: samples.slice(from - offset, to - offset) });
  }

  // A channel's chunks, put together from `from` to `to`.
  const join = (list, from, to) => {
    const channel = new Float32Array(Math.max(0, to - from));
    for (const { offset, samples } of list) {
      if (offset < to) channel.set(samples.subarray(0, to - offset), offset - from);
    }
    return channel;
  };

  async function run(length, want, covered) {
    const from = only ? only.keep.from : 0;
    const to = only ? Math.min(length, only.keep.to) : length;
    const left = join(chunks[0], from, to);
    const right = join(chunks[1], from, to);
    chunks[0] = chunks[1] = [];
    unpaired.forEach((map) => map.clear());
    const runModel = await createSession();
    const separator = createSeparator({
      left,
      right,
      runModel,
      keep: KEEP,
      offset: from,
      length,
      stats: stats.result(),
    });
    const { starts } = separator;
    const span = (i) => segmentSpan(starts, length, i);
    const total = starts.length;

    // An earlier run's segments need doing again only where they meet one
    // that isn't done: their blend there needs both.
    const separated = (i) => i < 0 || i >= total || within(covered, span(i));
    const skipped = new Set([...starts.keys()].filter((i) => separated(i - 1) && separated(i) && separated(i + 1)));
    const done = new Set(); // this run's
    // With a part, only the segments touching it.
    const todo = only ? segmentsFor(starts, length, only.from, only.to) : [...starts.keys()];
    let pending = todo.filter((i) => !skipped.has(i));
    let wanted = new Set();
    aim = (next) => {
      pending = orderOutward(starts, length, next, pending);
      wanted = new Set(segmentsFor(starts, length, next.from, next.to).filter((i) => !skipped.has(i)));
    };
    aim(only ?? want);
    if (only) aim = null; // the part is fixed
    const progress = () => {
      const wantedDone = [...wanted].filter((i) => done.has(i)).length;
      send({
        type: "progress",
        done: done.size + skipped.size,
        total,
        part: wanted.size ? wantedDone / wanted.size : 1,
        wanted: wantedDone === wanted.size,
      });
    };
    progress();

    while (pending.length) {
      const index = /** @type {number} */ (pending.shift());
      let { from, to } = await separator.runSegment(index);
      done.add(index);
      // Where it overlaps a neighbour not done in this run but separated
      // before, the earlier blend of both stays: this one alone would be
      // worse there.
      if (index > 0 && !done.has(index - 1)) {
        const overlap = { from, to: Math.min(span(index - 1).to, to) };
        if (within(covered, overlap)) from = overlap.to;
      }
      if (index + 1 < total && !done.has(index + 1)) {
        const overlap = { from: Math.max(span(index + 1).from, from), to };
        if (within(covered, overlap)) to = overlap.from;
      }
      if (from < to) {
        const start = Math.max(0, from - MARGIN);
        const stems = separator.read(start, Math.min(length, to + MARGIN));
        send({ type: "piece", from, to, start, names: KEEP, samples: KEEP.flatMap((name) => stems[name]) });
      }
      // What's sent is the page's: only the blend the segments still to do
      // add to or read (their pieces' margins) stays here, so a long song
      // doesn't hold a second copy of its stems. The pieces are the same.
      separator.keepFor(pending, MARGIN);
      progress();
    }
    aim = null;
    send({ type: "done" });
  }

  let want = null; // a "want" that came before the run began
  port.on("message", ({ data }) => {
    if (data?.type === "audio") take(data);
    else if (data?.type === "part") {
      only = { from: data.from, to: data.to, keep: { from: Math.max(0, data.from - REACH), to: data.to + REACH } };
    } else if (data?.type === "separate") {
      run(data.length, want ?? data.want, data.covered ?? []).catch((error) =>
        send({ type: "error", message: String(error?.message ?? error) }),
      );
    } else if (data?.type === "want") {
      want = { from: data.from, to: data.to };
      aim?.(want);
    } else if (data?.type === "close") process.exit(0);
  });
  // The page's end went away. Not to be relied on (it didn't come when the
  // page reloaded, measured): the main process stops this one then.
  port.on("close", () => process.exit(0));
  port.start();
}

process.parentPort.once("message", ({ data, ports }) => {
  if (data?.type === "port" && ports[0]) serve(ports[0]);
});
