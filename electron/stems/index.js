// Stem separation, the main process's part (the page's is
// src/features/stems/): the model's file (model-file.js) and the utility
// process that separates one song (process.js). The song and its stems
// don't pass through here: the page's stems worker and the process talk
// over a message channel made here, one end to each.
//
//   handleStems(ipcMain, { utilityProcess, MessageChannelMain, userData, devCopy?, fetch? })
//     "stems:model"     → { ready, bytes }: whether the model is there, and its size
//     "stems:download"  → { ok: true } | { ok: false, canceled?, error }: fetches it,
//                         sending "stems:progress" { fraction } meanwhile
//     "stems:start"     → { ok: true } | { ok: false, error }: starts a process,
//                         then sends the page "stems:port" with its end of the channel
//     "stems:cancel"    stops the download or the process
//   The process exits once the page has the stems (it says "close"); if it
//   stops before that, the page gets "stems:stopped" { error }. One song at
//   a time: starting another stops the one before.
const path = require("path");
const { createModelFile, ModelFileError } = require("./model-file");

const SCRIPT = path.join(__dirname, "process.js");

function handleStems(ipcMain, { utilityProcess, MessageChannelMain, userData, devCopy = null, fetch }) {
  const modelFile = createModelFile({ userData, devCopy, fetch });
  let job = null; // { child, sender, closing } while a process runs
  let download = null; // its AbortController, while downloading

  function stop() {
    const stopping = job;
    job = null;
    stopping?.child.kill();
  }

  ipcMain.handle("stems:model", () => modelFile.status());

  ipcMain.handle("stems:download", async (event) => {
    download = new AbortController();
    const send = (fraction) => !event.sender.isDestroyed() && event.sender.send("stems:progress", { fraction });
    try {
      await modelFile.download(send, download.signal);
      return { ok: true };
    } catch (error) {
      if (!(error instanceof ModelFileError)) console.error("The stem model's download failed:", error);
      return {
        ok: false,
        canceled: Boolean(error?.canceled),
        error: error instanceof ModelFileError ? error.message : `The download failed: ${error?.message ?? error}`,
      };
    } finally {
      download = null;
    }
  });

  ipcMain.handle("stems:start", (event) => {
    const model = modelFile.path();
    if (!model) return { ok: false, error: "The stem model isn't there yet." };
    stop();
    const sender = event.sender;
    const child = utilityProcess.fork(SCRIPT, [model], { serviceName: "EarBee stem separation" });
    const started = { child, sender };
    job = started;
    child.on("exit", (code) => {
      // Stopped here (cancelled, or another song started): the page knows.
      if (job !== started) return;
      job = null;
      if (code !== 0 && !sender.isDestroyed()) {
        sender.send("stems:stopped", { error: `Separating the stems stopped (${code}).` });
      }
    });
    const { port1, port2 } = new MessageChannelMain();
    child.postMessage({ type: "port" }, [port1]);
    // The window closing or reloading closes the page's end, and the
    // process exits (process.js).
    sender.postMessage("stems:port", null, [port2]);
    return { ok: true };
  });

  ipcMain.handle("stems:cancel", () => {
    download?.abort();
    stop();
  });

  return { stop };
}

module.exports = { handleStems };
