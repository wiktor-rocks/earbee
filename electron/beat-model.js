// The beat model (Beat This!, models/beat-this-small.onnx), run for the
// page: it sends one window of its spectrogram at a time (src/features/
// beats.js) and gets the model's beat and downbeat logits back.
//
// The model runs in a utility process (beat-model-process.js) on the
// native ONNX Runtime, multi-threaded: about 1 s per 30 s of sound, where
// the browser's WebAssembly build took 4. The process starts on the first
// window and stops after a minute without one, giving its memory back.
//
//   handleBeatModel(ipc, { utilityProcess })
//     answers "beats:window": a Float32Array of WINDOW values →
//     { ok: true, beat, downbeat } (Float32Arrays of 1500 logits) or
//     { ok: false, error } (e.g. no ONNX Runtime for this system: the page
//     then falls back to its simpler beat finder)
const path = require("path");

const FRAMES = 1500;
const WINDOW = FRAMES * 128;
const IDLE_MS = 60_000;

// The model and the process script, outside the app's asar archive when
// packaged (package.json "asarUnpack"): native code reads them as plain files.
const unpacked = (file) => file.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const MODEL = unpacked(path.join(__dirname, "..", "models", "beat-this-small.onnx"));
const SCRIPT = path.join(__dirname, "beat-model-process.js");

function createBeatModel(utilityProcess) {
  let child = null;
  let idleTimer = null;
  let nextId = 1;
  const pending = new Map(); // id → resolve

  function start() {
    child = utilityProcess.fork(SCRIPT, [MODEL], { serviceName: "EarBee beat model" });
    child.on("message", (message) => {
      const resolve = pending.get(message?.id);
      pending.delete(message?.id);
      resolve?.(message.ok ? { ok: true, beat: message.beat, downbeat: message.downbeat } : message);
    });
    child.on("exit", (code) => {
      child = null;
      for (const resolve of pending.values()) resolve({ ok: false, error: `the beat model stopped (${code})` });
      pending.clear();
    });
  }

  function stopWhenIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => child?.kill(), IDLE_MS);
  }

  return {
    /** @param {Float32Array} input */
    run(input) {
      if (!child) start();
      clearTimeout(idleTimer);
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, (answer) => {
          if (!pending.size) stopWhenIdle();
          resolve(answer);
        });
        child.postMessage({ id, input });
      });
    },
    stop: () => child?.kill(),
  };
}

function handleBeatModel(ipcMain, { utilityProcess }) {
  const model = createBeatModel(utilityProcess);
  ipcMain.handle("beats:window", (_event, input) => {
    if (!(input instanceof Float32Array) || input.length !== WINDOW) {
      return { ok: false, error: `a window is ${WINDOW} values` };
    }
    return model.run(input);
  });
  return model;
}

module.exports = { handleBeatModel, WINDOW };
