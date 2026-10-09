/* =====================================================================
 * UI: ELEMENTS, MESSAGES, RENDERING
 * Element lookups, generated markup, and render functions. Rendering
 * only reads state; it never changes it.
 * ===================================================================== */

import { player, settings, totalSemitones } from "../context.js";
import { AppError } from "../core/errors.js";
import { formatPitchTotal, formatStepSize, formatTrackTime } from "../core/format.js";

/** @param {string} id */
export const $ = (id) => document.getElementById(id);

export const dom = {
  welcome: $("welcome"),
  welcomeOpen: $("welcomeOpen"),
  welcomeMessage: $("welcomeMessage"),
  welcomeDownload: $("welcomeDownload"),
  loadingScreen: $("loadingScreen"),
  loadingStatus: $("loadingStatus"),
  loadingFileName: $("loadingFileName"),
  loadingCancel: $("loadingCancel"),
  app: $("app"),
  loadingOverlay: $("loadingOverlay"),
  overlayStatus: $("overlayStatus"),
  overlayTitle: $("overlayTitle"),
  overlayCancel: $("overlayCancel"),
  downloadButton: $("downloadButton"),
  downloadDialog: /** @type {HTMLDialogElement} */ ($("downloadDialog")),
  downloadForm: /** @type {HTMLFormElement} */ ($("downloadForm")),
  downloadUrl: /** @type {HTMLInputElement} */ ($("downloadUrl")),
  downloadClose: $("downloadClose"),
  downloadVideoLabel: $("downloadVideoLabel"),
  downloadFolder: $("downloadFolder"),
  fileInput: /** @type {HTMLInputElement} */ ($("file")),
  fileInfo: $("fileInfo"),
  fileName: $("fileName"),
  fileMeta: $("fileMeta"),
  message: $("message"),
  trackTime: $("trackTime"),
  loopInfo: $("loopInfo"),
  speedScale: $("speedScale"),
  volumeScale: $("volumeScale"),
  playButton: /** @type {HTMLButtonElement} */ ($("play")),
  playLabel: $("playLabel"),
  stopButton: /** @type {HTMLButtonElement} */ ($("stop")),
  stepBackButton: /** @type {HTMLButtonElement} */ ($("stepBack")),
  stepForwardButton: /** @type {HTMLButtonElement} */ ($("stepForward")),
  stepSize: $("stepSize"),
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
// notice means something works only partly (neutral).
export function showMessage(text, kind) {
  const line = dom.app.hidden ? dom.welcomeMessage : dom.message;
  line.textContent = text;
  line.classList.toggle("notice", kind === "notice");
}

export const showError = (text) => showMessage(text, "error");
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
  dom.stepSize.textContent = `Step ${formatStepSize(settings.stepSize)} s`;
}

// The loop readout next to the track time; dimmed while the loop is off.
export function renderLoopInfo(region) {
  dom.loopInfo.hidden = !region;
  if (!region) return;
  dom.loopInfo.textContent = `Loop ${formatTrackTime(region.start)} – ${formatTrackTime(region.end)}`;
  dom.loopInfo.classList.toggle("disabled", !region.enabled);
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
export const onClick = (element, handler) => element.addEventListener("click", guarded(handler));
