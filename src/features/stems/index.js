/* =====================================================================
 * STEMS
 * The open song split into its instruments (vocals, drums, bass, guitar,
 * piano, and the rest), by the stem model in the main process
 * (electron/stems/), on demand: the Stems section's button.
 *
 *   1. The first time, the model is downloaded (116 MB, once; the main
 *      process checks it).
 *   2. A worker (worker.js) decodes the song again at 44.1 kHz and streams
 *      it to the stem process, which separates it one 7.8 s segment at a
 *      time, at low priority (about as long as the song plays).
 *   3. The stems come back to the worker, then here, transferred.
 * Cancel, or opening another file, stops it: the worker ends, and the main
 * process stops the stem process.
 *
 * Self-contained: this folder, its stems.css, electron/stems/, and the
 * lines marked "Stems (" (app.js, open-file.js, index.html, config.js,
 * main.js, preload.js). With CONFIG.stems.enabled off, the section is
 * removed and nothing else happens.
 *
 *   bindStems()        builds the section (once, at startup)
 *   resetStems(media)  a new file is open: what was found is forgotten
 *   stemsFound()       the open song's stems, once separated (else null)
 * ===================================================================== */

import { CONFIG } from "../../config.js";
import { AppError } from "../../core/errors.js";
import { $, element, onClick, reportError } from "../../ui/dom.js";
import { notify } from "../../ui/toast.js";

/**
 * The part of window.earbee (electron/preload.js) used here; missing
 * outside Electron.
 * @typedef {{
 *   model(): Promise<{ ready: boolean, bytes: number }>,
 *   download(): Promise<{ ok: boolean, canceled?: boolean, error?: string }>,
 *   start(): Promise<{ ok: boolean, error?: string }>,
 *   cancel(): Promise<void>,
 *   onProgress(callback: (progress: { fraction: number }) => void): () => void,
 *   onStopped(callback: (stopped: { error: string }) => void): () => void,
 * }} StemsBridge
 */
const bridge = /** @type {StemsBridge | undefined} */ (/** @type {any} */ (window).earbee?.stems);

/**
 * The stems of the open song, once separated: each stem's two channels at
 * `sampleRate`, `length` samples long (without "other", which is the song
 * minus these).
 * @typedef {{ sampleRate: number, length: number, stems: Record<string, Float32Array[]> }} Stems
 */

/** @type {import("../../core/media.js").Media | null} */
let media = null; // the open song's, to read again
/** @type {Stems | null} */
let found = null;
let modelBytes = 0;
let modelReady = false;
// What's going on: "idle", "download", "decode", "separate" or "ready".
let stage = "idle";
let fraction = 0;
// The separation going on: `stop` ends its wait (cancel).
/** @type {{ cancelled: boolean, stop: () => void } | null} */
let job = null;

let ui = null; // the section's parts, once built

/* ---------- Separating ---------- */

// The stem process's port, which the preload posts to the window after
// start() (bindStems listens); a newer wait replaces an older one.
/** @type {((port: MessagePort) => void) | null} */
let portWaiter = null;
const nextPort = () => new Promise((resolve) => (portWaiter = resolve));

async function separate() {
  if (!bridge || !media || job) return;
  const current = { cancelled: false, stop: () => {} };
  job = current;
  const stillCurrent = () => job === current && !current.cancelled;
  try {
    if (!modelReady) {
      show("download", 0);
      const stopProgress = bridge.onProgress((progress) => stillCurrent() && show("download", progress.fraction));
      const downloaded = await bridge.download().finally(stopProgress);
      if (!stillCurrent()) return;
      if (!downloaded.ok) throw downloaded.canceled ? null : new AppError(downloaded.error);
      modelReady = true;
    }

    show("decode", 0);
    const port = nextPort();
    const started = await bridge.start();
    if (!stillCurrent()) return;
    if (!started.ok) throw new AppError(started.error);
    const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    let stopStopped = () => {};
    const result = await new Promise((resolve, reject) => {
      current.stop = () => reject(null);
      stopStopped = bridge.onStopped((stopped) => reject(new AppError(stopped.error)));
      worker.addEventListener("message", ({ data }) => {
        if (data.type === "progress") stillCurrent() && show(data.stage, data.fraction);
        else if (data.type === "done") resolve(data);
        else if (data.type === "error") reject(new AppError(`The stems couldn't be separated: ${data.message}`));
      });
      worker.addEventListener("error", (event) => {
        event.preventDefault();
        reject(new AppError(`The stems couldn't be separated: ${event.message || "the worker stopped"}`));
      });
      port.then((received) => worker.postMessage({ type: "separate", media, port: received }, [received]));
    }).finally(() => {
      stopStopped();
      worker.terminate();
    });
    if (!stillCurrent()) return;
    found = { sampleRate: result.sampleRate, length: result.length, stems: result.stems };
    job = null;
    show("ready", 1);
    notify("The stems are ready");
  } catch (error) {
    if (job !== current) return; // cancelled or replaced: nothing to report
    job = null;
    show("idle", 0);
    if (error) reportError(error);
  }
}

function cancel() {
  const stopping = job;
  if (!stopping) return;
  job = null;
  stopping.cancelled = true;
  stopping.stop(); // the worker ends with its wait
  bridge?.cancel();
  show(found ? "ready" : "idle", 0);
}

/* ---------- The section ---------- */

const percent = (value) => `${Math.floor(value * 100)} %`;
const megabytes = (bytes) => `${Math.round(bytes / 1e6)} MB`;

function show(nextStage, nextFraction) {
  stage = nextStage;
  fraction = nextFraction;
  render();
}

function render() {
  if (!ui) return;
  ui.section.hidden = !media;
  const busy = stage === "download" || stage === "decode" || stage === "separate";
  ui.action.hidden = busy || stage === "ready";
  ui.busy.hidden = !busy;
  ui.ready.hidden = stage !== "ready";
  ui.action.textContent = modelReady
    ? "Separate the stems"
    : `Separate the stems (${megabytes(modelBytes)} download, once)`;
  ui.action.title =
    "Split the song into vocals, drums, bass, guitar, piano and the rest. It runs in the background, " +
    "about as long as the song plays.";
  const label = {
    download: `Downloading the stem model ${percent(fraction)}`,
    decode: `Reading the song ${percent(fraction)}`,
    separate: `Separating ${percent(fraction)}`,
  }[stage];
  if (label) ui.status.textContent = label;
}

function build(section) {
  const action = element("button", { type: "button", className: "stems-action" });
  const status = element("span", { className: "stems-status" });
  const stopButton = element("button", { type: "button", className: "small", textContent: "Cancel" });
  const busy = element("div", { className: "stems-busy" }, status, stopButton);
  const ready = element("p", { className: "stems-ready", textContent: "Stems ready" });
  section.append(
    element("div", { className: "dock-title" }, element("h2", { textContent: "Stems" })),
    action,
    busy,
    ready,
  );
  onClick(action, separate);
  onClick(stopButton, cancel);
  return { section, action, busy, status, ready };
}

/* ---------- Wiring ---------- */

export function bindStems() {
  const section = $("stemsSection");
  if (!CONFIG.stems.enabled || !bridge) {
    section?.remove();
    return;
  }
  ui = build(section);
  render();
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data !== "earbee:stems-port") return;
    const waiter = portWaiter;
    portWaiter = null;
    if (waiter) waiter(event.ports[0]);
    else event.ports[0]?.close(); // nobody's waiting: the process exits
  });
  bridge
    .model()
    .then((model) => {
      modelReady = model.ready;
      modelBytes = model.bytes;
      render();
    })
    .catch((error) => console.warn("The stem model's status is unknown:", error));
}

/** @param {import("../../core/media.js").Media | null} next */
export function resetStems(next) {
  cancel();
  media = next;
  found = null;
  show("idle", 0);
}

/** The open song's stems, once separated (else null). @returns {Stems | null} */
export const stemsFound = () => found;
