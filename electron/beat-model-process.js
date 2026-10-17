// The beat model's utility process (started by beat-model.js): runs
// models/beat-this-small.onnx (its path is the first argument) on the
// native ONNX Runtime, one spectrogram window at a time.
//   ← { id, input }  a Float32Array of 1500 × 128 values
//   → { id, ok: true, beat, downbeat }  1500 logits each
//     or { id, ok: false, error }
const fs = require("fs");
const os = require("os");

const FRAMES = 1500;
// More threads stopped helping at 4 (measured: 2.4 s per window on 1,
// 1.4 on 2, 0.95 on 4, 1.3 on 6), and the page needs some CPU too.
const THREADS = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));

let session = null;

async function load() {
  // Required here, not at the top: on a system without an ONNX Runtime
  // build (e.g. an Intel Mac) each answer says so instead of the process dying.
  const ort = require("onnxruntime-node");
  const created = await ort.InferenceSession.create(fs.readFileSync(process.argv.at(-1)), {
    intraOpNumThreads: THREADS,
    executionProviders: ["cpu"],
    // With memory-pattern planning on, the second run crashed the process
    // (SIGTRAP) in Electron's utility process, though not in plain Node.
    // Off, it's as fast (measured, ONNX Runtime 1.30).
    enableMemPattern: false,
  });
  return { ort, created };
}

process.parentPort.on("message", async ({ data: { id, input } }) => {
  try {
    session ??= load();
    const { ort, created } = await session;
    const out = await created.run({ spect: new ort.Tensor("float32", input, [1, FRAMES, 128]) });
    process.parentPort.postMessage({ id, ok: true, beat: out.beat.data, downbeat: out.downbeat.data });
  } catch (error) {
    session = null;
    process.parentPort.postMessage({ id, ok: false, error: String(error?.message ?? error) });
  }
});
