// The stem model's utility process (started by index.js for one song):
// runs models/htdemucs-6s.onnx (its path is the first argument) on the
// native ONNX Runtime, through separate.js, and talks to the page's stems
// worker (src/features/stems/worker.js) directly, over the port it's given
// first: the song and its stems never pass through the main process.
//
//   main → { type: "port" } with the port
//   page → { type: "audio", channel, offset, samples }  the song at 44.1 kHz, in chunks
//   page → { type: "separate", length }                 all of it has come
//   ←      { type: "progress", done, total }            segments done
//   ←      { type: "stems", names, length, sampleRate, peaks } then, for each stem and channel,
//   ←      { type: "stem", name, channel, offset, samples }  in chunks
//   ←      { type: "done" }
//   ←      { type: "error", message }
//   page → { type: "close" }                            got it all: the process exits
//                                                       (index.js stops it if the page goes away)
//
// In chunks, so no message holds a whole song (its six stems are hundreds
// of MB), and the page can turn each one to 16 bits as it comes.
// Cancelling kills the process (index.js).
const fs = require("fs");
const os = require("os");
const { separate, RATE, SEGMENT, STEMS } = require("./separate");

const CHUNK = 1 << 20; // samples a message (4 MB)
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

// The loudest sample (a plain loop: reduce() over millions of samples takes seconds).
function largest(samples) {
  let most = 0;
  for (let i = 0; i < samples.length; i++) most = Math.max(most, Math.abs(samples[i]));
  return most;
}

// `port`: the MessagePortMain the main process handed over.
function serve(port) {
  const chunks = [[], []]; // per channel: { offset, samples }
  const send = (message) => port.postMessage(message);

  // A channel's chunks, put together.
  const join = (list, length) => {
    const channel = new Float32Array(length);
    for (const { offset, samples } of list) channel.set(samples.subarray(0, length - offset), offset);
    return channel;
  };

  async function run(length) {
    const left = join(chunks[0], length);
    const right = join(chunks[1], length);
    chunks[0] = chunks[1] = [];
    const runModel = await createSession();
    const { stems } = await separate({
      left,
      right,
      runModel,
      keep: KEEP,
      onProgress: (done, total) => send({ type: "progress", done, total }),
    });
    // Each stem's loudest sample, so the page can store it in 16 bits as it comes.
    const peaks = KEEP.map((name) => stems[name].reduce((peak, channel) => Math.max(peak, largest(channel)), 0));
    send({ type: "stems", names: KEEP, length, sampleRate: RATE, peaks });
    for (const name of KEEP) {
      for (const channel of [0, 1]) {
        const samples = stems[name][channel];
        for (let offset = 0; offset < length; offset += CHUNK) {
          send({ type: "stem", name, channel, offset, samples: samples.slice(offset, offset + CHUNK) });
        }
      }
      delete stems[name]; // its memory can go as soon as it's sent
    }
    send({ type: "done" });
  }

  port.on("message", ({ data }) => {
    if (data?.type === "audio") chunks[data.channel].push({ offset: data.offset, samples: data.samples });
    else if (data?.type === "separate") {
      run(data.length).catch((error) => send({ type: "error", message: String(error?.message ?? error) }));
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
