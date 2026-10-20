/* =====================================================================
 * UI: ELEMENTS, MESSAGES, RENDERING
 * Element lookups, generated markup, and render functions. Rendering
 * only reads state; it never changes it.
 * ===================================================================== */

import { beats, hasAudio, player, settings, totalSemitones } from "../context.js";
import { BEAT_STEP_EPSILON, barBeatAt, onGrid } from "../core/beats.js";
import { AppError } from "../core/errors.js";
import { formatPitchTotal, formatSpeed, formatStepSize, formatTrackTime } from "../core/format.js";

/** @param {string} id */
export const $ = (id) => document.getElementById(id);

export const dom = {
  welcome: $("welcome"),
  welcomeOpen: $("welcomeOpen"),
  welcomeMessage: $("welcomeMessage"),
  welcomeDownload: $("welcomeDownload"),
  welcomeProjectFormat: $("welcomeProjectFormat"),
  welcomeDropText: $("welcomeDropText"),
  dropOverlayText: $("dropOverlayText"),
  loadingScreen: $("loadingScreen"),
  loadingStatus: $("loadingStatus"),
  loadingFileName: $("loadingFileName"),
  loadingCancel: $("loadingCancel"),
  app: $("app"),
  loadingOverlay: $("loadingOverlay"),
  overlayStatus: $("overlayStatus"),
  overlayTitle: $("overlayTitle"),
  overlayCancel: $("overlayCancel"),
  fileMenuButton: $("fileMenuButton"),
  fileMenu: $("fileMenu"),
  openButton: $("openButton"),
  downloadButton: $("downloadButton"),
  saveButton: $("saveButton"),
  saveAsButton: $("saveAsButton"),
  saveDialog: /** @type {HTMLDialogElement} */ ($("saveDialog")),
  saveForm: /** @type {HTMLFormElement} */ ($("saveForm")),
  saveModeLink: /** @type {HTMLInputElement} */ ($("saveModeLink")),
  saveModeEmbed: /** @type {HTMLInputElement} */ ($("saveModeEmbed")),
  saveMediaName: $("saveMediaName"),
  saveLinkNote: $("saveLinkNote"),
  saveCancel: $("saveCancel"),
  downloadDialog: /** @type {HTMLDialogElement} */ ($("downloadDialog")),
  downloadForm: /** @type {HTMLFormElement} */ ($("downloadForm")),
  downloadUrl: /** @type {HTMLInputElement} */ ($("downloadUrl")),
  downloadClose: $("downloadClose"),
  downloadVideoLabel: $("downloadVideoLabel"),
  downloadFolder: $("downloadFolder"),
  downloadSubmit: $("downloadSubmit"),
  downloadChapters: /** @type {HTMLInputElement} */ ($("downloadChapters")),
  searchSource: /** @type {HTMLSelectElement} */ ($("searchSource")),
  searchStatus: $("searchStatus"),
  searchResults: $("searchResults"),
  searchMore: /** @type {HTMLButtonElement} */ ($("searchMore")),
  fileInput: /** @type {HTMLInputElement} */ ($("file")),
  fileInfo: $("fileInfo"),
  fileName: $("fileName"),
  fileMeta: $("fileMeta"),
  message: $("message"),
  trackTime: $("trackTime"),
  loopInfo: $("loopInfo"),
  barBeat: $("barBeat"),
  loopPrevPhrase: /** @type {HTMLButtonElement} */ ($("loopPrevPhrase")),
  loopHalve: /** @type {HTMLButtonElement} */ ($("loopHalve")),
  loopBar: /** @type {HTMLButtonElement} */ ($("loopBar")),
  loopDouble: /** @type {HTMLButtonElement} */ ($("loopDouble")),
  loopNextPhrase: /** @type {HTMLButtonElement} */ ($("loopNextPhrase")),
  zoomIn: $("zoomIn"),
  zoomOut: $("zoomOut"),
  speedScale: $("speedScale"),
  volumeScale: $("volumeScale"),
  playButton: /** @type {HTMLButtonElement} */ ($("play")),
  playLabel: $("playLabel"),
  stopButton: /** @type {HTMLButtonElement} */ ($("stop")),
  stepBackButton: /** @type {HTMLButtonElement} */ ($("stepBack")),
  stepForwardButton: /** @type {HTMLButtonElement} */ ($("stepForward")),
  stepSize: $("stepSize"),
  beatInfo: $("beatInfo"),
  beatMenu: $("beatMenu"),
  startPointButton: $("startPoint"),
  stopPointButton: $("stopPoint"),
  speedChips: $("speedChips"),
  pitchValue: $("pitchValue"),
  resetPitchButton: $("resetPitch"),
  eqSection: $("eqSection"),
  eqFaders: $("eqFaders"),
  eqToggle: $("eqToggle"),
  resetEqButton: $("resetEq"),
  shortcutList: $("shortcutList"),
  shortcutsDialog: /** @type {HTMLDialogElement} */ ($("shortcutsDialog")),
  shortcutsClose: $("shortcutsClose"),
  helpButton: $("helpButton"),
  sidebarToggle: $("sidebarToggle"),
  sidebar: $("sidebar"),
  workspace: $("workspace"),
  marksList: $("marksList"),
  marksEmpty: $("marksEmpty"),
  marksCount: $("marksCount"),
  addPointButton: $("addPoint"),
  addRegionButton: $("addRegion"),
};

export const speedChips = () => /** @type {HTMLButtonElement[]} */ ([...dom.speedChips.children]);
const transportButtons = () => [dom.playButton, dom.stopButton, dom.stepBackButton, dom.stepForwardButton];

/* ---------- Errors and notices ---------- */

// One message line: in the transport bar, or under the drop zone while
// the welcome screen is up. An error means something failed (red); a
// notice means something works only partly (neutral). Confirmations that
// something worked are notifications instead (notify, ui/toast.js).
function showMessage(text, kind) {
  const line = dom.app.hidden ? dom.welcomeMessage : dom.message;
  line.textContent = text;
  line.classList.toggle("notice", kind === "notice");
}

const showError = (text) => showMessage(text, "error");
export const showNotice = (text) => showMessage(text, "notice");
export const clearMessage = () => showMessage("", "notice");

export function reportError(error) {
  console.error(error);
  showError(error instanceof AppError ? error.message : `Something went wrong: ${error?.message ?? error}`);
}

// Wraps an event handler so its failures are shown instead of dropped.
export const guarded =
  (handler) =>
  (...args) =>
    Promise.resolve()
      .then(() => handler(...args))
      .catch(reportError);

/* ---------- Renderers ---------- */

// The one place that turns the transport state into UI.
export function renderTransportState(state) {
  dom.playLabel.textContent = state === "playing" ? "Pause" : "Play";
  dom.playButton.classList.toggle("playing", state === "playing");
  for (const button of transportButtons()) button.disabled = state === "empty";
}

// The position large, the duration after it smaller ("1:05.250 / 3:41.000").
const timeParts = {
  position: element("span", { className: "time-position" }),
  total: element("span", { className: "time-total" }),
};
export function renderTrackTime(position) {
  if (!timeParts.position.isConnected) dom.trackTime.replaceChildren(timeParts.position, timeParts.total);
  const shown = formatTrackTime(position);
  if (timeParts.position.textContent !== shown) timeParts.position.textContent = shown;
  const total = ` / ${formatTrackTime(player.transport.duration)}`;
  if (timeParts.total.textContent !== total) timeParts.total.textContent = total;
}

// The step readout in the transport bar (the step buttons show arrows).
export function renderStepSize() {
  const { stepSize } = settings;
  dom.stepSize.textContent = typeof stepSize === "string" ? `Step 1 ${stepSize}` : `Step ${formatStepSize(stepSize)} s`;
}

// The bar and the beat in it, over the waveform ("Bar 5 · 3"), while the
// beats with their bars are found and shown; follows the position.
const barBeatParts = {
  bar: element("b", {}),
  beat: element("span", { className: "bar-beat-beat" }),
};
let shownBarBeat = "";
export function renderBarBeat(position) {
  const at = beats.status === "found" && beats.shown ? barBeatAt(beats.bars, beats.times, position) : null;
  const key = at ? `${at.bar}·${at.beat}` : "";
  if (key === shownBarBeat) return;
  shownBarBeat = key;
  dom.barBeat.hidden = !at;
  if (!at) return;
  if (!barBeatParts.bar.isConnected) dom.barBeat.replaceChildren(barBeatParts.bar, barBeatParts.beat);
  barBeatParts.bar.textContent = `Bar ${at.bar}`;
  barBeatParts.beat.textContent = ` · ${at.beat}`;
}

// The beats readout over the waveform: a button that finds them, their
// progress, then the tempo (and the tempo heard, at another speed, and
// the progress while the model fills in the rest); dimmed while their
// lines are hidden. Its tooltip says which finder found them.
export function renderBeatInfo() {
  const chip = dom.beatInfo;
  chip.hidden = !hasAudio();
  chip.classList.toggle("disabled", beats.status === "found" && !beats.shown);
  if (beats.status === "finding") {
    chip.textContent = `♩ Finding the beats ${Math.floor(beats.progress * 100)} %`;
    chip.title = "Finding the beats (B to stop)";
  } else if (beats.status === "found") {
    const bpm = Math.round(beats.bpm);
    const heard =
      settings.speed === 1 ? "" : `${Math.round(beats.bpm * settings.speed)} at ${formatSpeed(settings.speed)}`;
    const filling = beats.complete ? "" : ` · ${Math.floor(beats.progress * 100)} %`;
    chip.textContent = `♩ ${bpm} BPM${heard && ` · ${heard}`}${filling}`;
    const by =
      beats.method === "model"
        ? beats.complete
          ? "Found by the beat model"
          : "Found so far by the beat model, which is still going through the rest of the track"
        : "Found by the simple beat finder (no bars)";
    chip.title = `About ${bpm} beats per minute${heard && ` (${heard})`}. ${by}. Click for the beats menu; B ${beats.shown ? "hides" : "shows"} the beat lines.`;
  } else if (beats.status === "none") {
    chip.textContent = "♩ No steady beat";
    chip.title = "No steady beat was found in this track";
  } else {
    chip.textContent = "♩ Find the beats";
    chip.title = "Find the beats: lines on the waveform, the tempo, and ← / → stepping by beats (B)";
  }
  // The loop's length in bars comes and goes with the beats.
  renderLoopInfo(shownLoop);
  renderBarBeat(player.transport?.position ?? 0);
}

// The loop readout over the waveform, dimmed while the loop is off: its
// length in bars when it lies on whole bars ("1 bar ·"), then its start
// and end (each part a span, so a narrow window can drop the times; the
// tooltip has them in full). The loop is kept for the beats readout,
// which redraws this when the bars change.
/** @type {{ start: number, end: number, enabled: boolean } | null} */
let shownLoop = null;
const loopParts = {
  bars: element("span", { className: "loop-bars" }),
  range: element("span", { className: "loop-range" }),
};
export function renderLoopInfo(region) {
  shownLoop = region;
  dom.loopInfo.hidden = !region;
  if (!region) return;
  const start = formatTrackTime(region.start);
  const end = formatTrackTime(region.end);
  const onBars =
    beats.status === "found" && beats.bars?.length
      ? onGrid(beats.bars, region.start, region.end, beats.barLength, BEAT_STEP_EPSILON)
      : null;
  const count = onBars && onBars.to - onBars.from;
  loopParts.bars.textContent = count ? `${count} ${count === 1 ? "bar" : "bars"} · ` : "";
  loopParts.range.textContent = `${start}–${end}`;
  if (!loopParts.bars.isConnected) dom.loopInfo.replaceChildren("↻ ", loopParts.bars, loopParts.range);
  dom.loopInfo.title = `Loop ${start} – ${end}${region.enabled ? "" : " (off)"}`;
  dom.loopInfo.classList.toggle("disabled", !region.enabled);
}

// The loop toolbar over the waveform: halving, doubling and moving need a
// loop; the bar button shows whether one is on.
export function renderLoopTools(region) {
  for (const button of [dom.loopPrevPhrase, dom.loopHalve, dom.loopDouble, dom.loopNextPhrase]) {
    button.disabled = !region;
  }
  dom.loopBar.setAttribute("aria-pressed", String(Boolean(region?.enabled)));
}

export function renderSpeedChips() {
  for (const chip of speedChips()) {
    chip.classList.toggle("active", Number(chip.dataset.speed) === settings.speed);
  }
}

export function renderPitchTotal() {
  dom.pitchValue.textContent = formatPitchTotal(totalSemitones());
}

export function renderEqEnabled() {
  dom.eqToggle.textContent = settings.eqEnabled ? "On" : "Off";
  dom.eqToggle.setAttribute("aria-pressed", String(settings.eqEnabled));
  dom.eqSection.classList.toggle("bypassed", !settings.eqEnabled);
}

// Shows that `name` (a file, or a link being downloaded) is loading, or
// (null) that loading is over.
//   First file: the loading screen replaces the welcome screen. The player
//     may be shown underneath during the load (showPlayer() runs before the
//     waveform draws, so it can measure itself); the opaque screen hides it.
//   Later files: a translucent overlay over the player.
// Whatever is underneath is inert, so it can't be clicked, focused or typed into.
export function setLoading(name) {
  const busy = name !== null;
  dom.app.inert = busy;
  setLoadingStatus("Loading");
  dom.overlayTitle.textContent = "";

  if (busy && dom.app.hidden) {
    dom.loadingFileName.textContent = name;
    dom.welcome.hidden = true;
    dom.loadingScreen.hidden = false;
    return;
  }
  dom.loadingOverlay.hidden = !busy;
  if (busy) return;

  dom.loadingScreen.hidden = true;
  // The first file failed: back to the welcome screen, which shows the error.
  if (dom.app.hidden && dom.welcome.hidden) {
    dom.welcome.hidden = false;
    dom.welcomeOpen.focus();
  }
}

// What the loading screen and overlay say ("Downloading… 42 %"), and
// whether they offer Cancel (only while downloading).
export function setLoadingStatus(text, cancelable = false) {
  dom.loadingStatus.textContent = text;
  dom.overlayStatus.textContent = text;
  dom.loadingCancel.hidden = !cancelable;
  dom.overlayCancel.hidden = !cancelable;
}

// Swaps the welcome screen for the player, once, when the first file loads
// (under the loading screen, which setLoading(null) then removes).
export function showPlayer() {
  dom.welcome.hidden = true;
  dom.app.hidden = false;
}

/* ---------- Generated markup and handlers ---------- */

export function element(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// A click handler whose failures are shown to the user (see guarded).
export const onClick = (target, handler) => target.addEventListener("click", guarded(handler));
