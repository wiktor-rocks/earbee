// Stems: the stem process (electron/stems/process.js) as it is, but with
// each run of the model taking a while longer (the first argument, in ms),
// so topic 21 can see a separation in the middle: the loop done and the
// rest still to come, Stop, and carrying on. The harness starts this
// instead of the process itself while h.setStemDelay(ms) is on.
//   argv: [delay, script, model]  (the script reads the model from the last)
const path = require("path");

const delay = Number(process.argv.at(-3));
const script = process.argv.at(-2);
const ort = require(require.resolve("onnxruntime-node", { paths: [path.dirname(script)] }));
const run = ort.InferenceSession.prototype.run;
ort.InferenceSession.prototype.run = async function (...args) {
  await new Promise((resolve) => setTimeout(resolve, delay));
  return run.apply(this, args);
};
require(script);
