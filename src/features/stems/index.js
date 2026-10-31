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
 *   3. The stems come back to the worker, which turns them into the
 *      track's rate in 16 bits, then here, and on to the player
 *      (audio/engine.js loadStems): they play through the same stretcher
 *      as the track, mixed into its input, so they keep in step at any
 *      speed, pitch or loop.
 * Cancel, or opening another file, stops it: the worker ends, and the main
 * process stops the stem process.
 *
 * Then the section is a mixer (dock.js): each stem's volume, solo and
 * mute, turned into gains (mix.js) for the player. "Other" is the song
 * minus the five stems, so with every stem at full volume it plays the
 * song exactly as it is.
 *
 * Self-contained: this folder, its stems.css, electron/stems/, and the
 * lines marked "Stems (" (app.js, open-file.js, index.html, config.js,
 * main.js, preload.js). With CONFIG.stems.enabled off, the section is
 * removed and nothing else happens.
 *
 *   bindStems()        builds the section (once, at startup)
 *   resetStems(media)  a new file is open: what was found is forgotten
 *   stemsFound()       what was found for the open song (else null)
 * ===================================================================== */

import { CONFIG } from "../../config.js";
import { player } from "../../context.js";
import { AppError } from "../../core/errors.js";
import { $, element, onClick, reportError } from "../../ui/dom.js";
import { notify } from "../../ui/toast.js";
import { buildMixer } from "./dock.js";
import { defaultMix, stemGains } from "./mix.js";

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
 * What was found for the open song (the samples themselves went to the
 * player): the stems' ids in the player's order (without "other", the song
 * minus these), at `sampleRate`, `length` samples long, and each one's
 * loudness.
 * @typedef {{ sampleRate: number, length: number, ids: string[], levels: Record<string, number> }} Stems
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
// Each stem's volume, solo and mute (mix.js).
let mix = defaultMix(CONFIG.stems.list);
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
    // To the player, in its order; the samples are transferred.
    const ids = CONFIG.stems.list.map(({ id }) => id).filter((id) => result.stems[id]);
    await player.engine.loadStems(ids.map((id) => result.stems[id]));
    if (!stillCurrent()) return;
    const levels = Object.fromEntries(ids.map((id) => [id, result.stems[id].level]));
    found = { sampleRate: result.sampleRate, length: result.length, ids, levels };
    job = null;
    applyMix();
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

/* ---------- The mix ---------- */

// The player's gains from the mix (it ignores them until stems are loaded).
function applyMix() {
  if (!found) return;
  const gains = stemGains(CONFIG.stems.list, mix);
  player.engine.setStemGains(
    found.ids.map((id) => gains[id]),
    gains.other,
  );
}

/** @param {string} id @param {Partial<import("./mix.js").StemSetting>} change */
function changeMix(id, change) {
  mix = { ...mix, [id]: { ...mix[id], ...change } };
  applyMix();
  render();
}

function resetMix() {
  mix = defaultMix(CONFIG.stems.list);
  applyMix();
  render();
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
  ui.mixer.hidden = stage !== "ready";
  ui.reset.hidden = stage !== "ready";
  if (stage === "ready") ui.mixerRows.render(mix);
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
  const reset = element("button", {
    type: "button",
    className: "icon-button small",
    title: "All stems back to full volume, none soloed or muted",
    ariaLabel: "Reset the stems",
    innerHTML: '<svg class="icon" aria-hidden="true"><use href="#i-reset" /></svg>',
  });
  const mixer = element("div", { className: "stems-mixer" });
  const mixerRows = buildMixer(mixer, { list: CONFIG.stems.list, range: CONFIG.stems.volume, onChange: changeMix });
  section.append(
    element(
      "div",
      { className: "dock-title" },
      element("h2", { textContent: "Stems" }),
      element("div", { className: "dock-title-row" }, reset),
    ),
    action,
    busy,
    mixer,
  );
  onClick(action, separate);
  onClick(stopButton, cancel);
  onClick(reset, resetMix);
  return { section, action, busy, status, mixer, mixerRows, reset };
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
  // The player dropped them with the old track; this is for a load that
  // was on its way.
  if (found) player.engine.dropStems();
  found = null;
  mix = defaultMix(CONFIG.stems.list);
  show("idle", 0);
}

/** What was found for the open song (else null). @returns {Stems | null} */
export const stemsFound = () => found;
