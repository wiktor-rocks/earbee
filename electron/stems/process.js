// The stem model's utility process (started by index.js for one song):
// runs models/htdemucs-6s.onnx (its path is the first argument) on the
// native ONNX Runtime, through separate.js, and talks to the page's stems
// worker (src/features/stems/worker.js) directly, over the port it's given
// first: the song and its stems never pass through the main process.
//
// The part wanted (the loop) is separated first, then the rest, nearest it
// first; each segment's stems go back as soon as it's done, so they play
// there at once. All positions are samples at 44.1 kHz.
//
//   main → { type: "port" } with the port
//   page → { type: "audio", channel, offset, samples }  the song at 44.1 kHz, in chunks
//   page → { type: "separate", length, want: { from, to }, covered }
//          all of it has come; `covered`: [[from, to], …] already separated
//          (an earlier run's), skipped where it can be
//   page → { type: "want", from, to }                   the loop moved: that next
//   ←      { type: "piece", from, to, start, names, samples }
//          the stems over [from, to): `samples` is each stem's left and
//          right, in `names` order, from `start`, with up to MARGIN samples
//          either side (to resample the piece on its own)
//   ←      { type: "progress", done, total, part, wanted }
//          segments done; part: how much of the part wanted is, wanted: all of it
//   ←      { type: "done" }                             every segment is
//   ←      { type: "error", message }
//   page → { type: "close" }                            no more wanted: the process exits
//                                                       (index.js stops it if the page goes away)
//
// The song comes in chunks, so no message holds a whole song (its six
// stems are hundreds of MB). Cancelling kills the process (index.js).
const fs = require("fs");
const os = require("os");
const { createSeparator, orderOutward, segmentSpan, segmentsFor, SEGMENT, STEMS } = require("./separate");

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
  const chunks = [[], []]; // per channel: { offset, samples }
  const send = (message) => port.postMessage(message);
  let aim = null; // while running: points it at the part wanted next

  // A channel's chunks, put together.
  const join = (list, length) => {
    const channel = new Float32Array(length);
    for (const { offset, samples } of list) channel.set(samples.subarray(0, length - offset), offset);
    return channel;
  };

  async function run(length, want, covered) {
    const left = join(chunks[0], length);
    const right = join(chunks[1], length);
    chunks[0] = chunks[1] = [];
    const runModel = await createSession();
    const separator = createSeparator({ left, right, runModel, keep: KEEP });
    const { starts } = separator;
    const span = (i) => segmentSpan(starts, length, i);
    const total = starts.length;

    // An earlier run's segments need doing again only where they meet one
    // that isn't done: their blend there needs both.
    const separated = (i) => i < 0 || i >= total || within(covered, span(i));
    const skipped = new Set([...starts.keys()].filter((i) => separated(i - 1) && separated(i) && separated(i + 1)));
    const done = new Set(); // this run's
    let pending = [...starts.keys()].filter((i) => !skipped.has(i));
    let wanted = new Set();
    aim = (next) => {
      pending = orderOutward(starts, length, next, pending);
      wanted = new Set(segmentsFor(starts, length, next.from, next.to).filter((i) => !skipped.has(i)));
    };
    aim(want);
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
      progress();
    }
    aim = null;
    send({ type: "done" });
  }

  let want = null; // a "want" that came before the run began
  port.on("message", ({ data }) => {
    if (data?.type === "audio") chunks[data.channel].push({ offset: data.offset, samples: data.samples });
    else if (data?.type === "separate") {
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
