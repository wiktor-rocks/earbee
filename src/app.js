// @ts-check
/* =====================================================================
 * TranscriBee: renderer script
 *
 * A music-transcription player: open a song or a video, slow it down,
 * shift its pitch, EQ it, and step through it with the keyboard.
 *
 * HOW IT FITS TOGETHER
 *
 *   user input ─► bindings ─► actions ─► transport ─► engine ─► speakers
 *                                │                      ▲
 *                                └─► setSetting() ──────┘
 *   transport.on("position" | "state" | "jump") ─► waveform, video, UI
 *
 *   engine     Web Audio graph: Signalsmith (speed + pitch) → EQ → volume
 *              → limiter. Knows nothing about the UI or `settings`.
 *   transport  Playback state and position. Mirrors Signalsmith's timeline,
 *              so the position of what is being heard is computed exactly.
 *   waveform   WaveSurfer drawing, zoom, minimap and the A–B loop region.
 *              Never plays audio.
 *   video      Frame-exact picture for video files: decodes frames itself
 *              (Mediabunny + WebCodecs) and draws the frame at the transport
 *              position. No second clock, so it can't drift from the audio.
 *   settings   The single copy of every user setting (plain values).
 *
 *   Until the first file loads, a welcome screen (#welcome) stands in for
 *   the player (#app); showPlayer() swaps them once (§9, §11). The first
 *   load shows a loading screen (#loadingScreen) in their place; later
 *   loads an overlay over the player (setLoading, §9).
 *
 *   Links (YouTube) are downloaded by the main process: downloader.js,
 *   reached through window.transcribee (preload.js). The page shows the
 *   progress, then opens the downloaded file like any other (§11).
 *
 * SECTIONS
 *   1 Config   2 Pure helpers   3 Settings   4 Audio engine   5 Transport
 *   6 Waveform   7 Video   8 Instances   9 UI   10 Setting controls
 *   11 File loading   12 Playback actions   13 Keyboard shortcuts   14 Startup
 *
 * COMMON CHANGES
 *   Speed preset or EQ band   Edit CONFIG.speed.presets / CONFIG.eq.bands.
 *                             The buttons and faders are generated.
 *   Step sizes (← / →)        Edit CONFIG.step.sizes (↑ / ↓ cycle through them).
 *   Slider range or default   Edit CONFIG. Sliders get min/max/step from it,
 *                             and the scale labels under them are generated.
 *   New slider setting        Add a range to CONFIG, a value to `settings`,
 *                             an entry to SLIDERS (§10), and an
 *                             <input type="range"> plus readout to index.html.
 *   New keyboard shortcut     Add an entry to SHORTCUTS (§13); the legend
 *                             at the bottom of the window updates itself.
 *   Colours and fonts         Tokens at the top of style.css (the waveform
 *                             reads its colours from there too).
 *   Video file types          CONFIG.video.extensions (also anything with a
 *                             video/* type). Codecs are whatever WebCodecs
 *                             decodes: H.264, VP8/VP9, AV1; not HEVC here.
 *   A new view that follows   Subscribe to transport.on("position"/"state"/
 *   playback                  "jump") in §8, like the waveform and video.
 *   A–B loop                  State and actions in §12 (setLoopRegion);
 *                             audio looping in the transport (§5), drawing
 *                             and dragging in the waveform (§6).
 *   Any change                Run `npm run check` and `npm test`, and record
 *                             it in CHANGELOG.md (what, why, how, where), so
 *                             the next person or LLM can follow.
 * ===================================================================== */

import { createAudioEngine } from "./audio/engine.js";
import { createTransport } from "./audio/transport.js";
import { CONFIG } from "./config.js";
import { AppError } from "./core/errors.js";
import { isVideoFile } from "./core/files.js";
import {
  clamp,
  formatFrequency,
  formatGain,
  formatGigabytes,
  formatEta,
  formatPercent,
  formatPitchTotal,
  formatSigned,
  formatSpeed,
  formatStepSize,
  formatTrackTime,
} from "./core/format.js";
import { downsamplePeaks, peaksPerSecondFor } from "./core/peaks.js";
import { createVideoView } from "./video/view.js";
import { createWaveform } from "./waveform.js";

/** @typedef {import("./core/timeline.js").Segment} Segment */

/* =====================================================================
 * 3. SETTINGS
 * The single copy of every user setting. Change values through
 * setSetting() (§10) so the UI and the audio follow.
 * ===================================================================== */

const settings = {
  speed: CONFIG.speed.initial,
  volume: CONFIG.volume.initial, // percent
  semitones: CONFIG.semitones.initial,
  cents: CONFIG.cents.initial,
  eqEnabled: CONFIG.eq.enabledInitially,
  stepSize: CONFIG.step.initial, // seconds, one of CONFIG.step.sizes
  // One gain (dB) per EQ band, keyed by band id: eqLow, eqLowMid, …
  ...Object.fromEntries(CONFIG.eq.bands.map((band) => [band.id, CONFIG.eq.gain.initial])),
};

const totalSemitones = () => settings.semitones + settings.cents / 100;
const eqGains = () => Object.fromEntries(CONFIG.eq.bands.map((band) => [band.id, settings[band.id]]));

/* =====================================================================
 * 8. INSTANCES
 * The components, wired to each other and to the UI. Their callbacks
 * only run after startup, so the UI functions they use (declared below)
 * are ready by then.
 * ===================================================================== */

/** @param {string} id */
const $ = (id) => document.getElementById(id);

const engine = createAudioEngine({ onError: reportError });

const transport = createTransport({
  engine,
  getRate: () => settings.speed,
  getSemitones: totalSemitones,
});

const waveform = createWaveform({
  container: $("waveform"),
  minimapContainer: $("waveform-minimap"),
  onSeek: (time) => transport.seek(time),
  onLoopChange: (loop) => setLoopRegion({ ...loop, enabled: true }),
});

const videoView = createVideoView({
  pane: $("videoPane"),
  canvas: /** @type {HTMLCanvasElement} */ ($("videoCanvas")),
  onVisibilityChange: (visible) => $("stage").classList.toggle("has-video", visible),
  onProblem: (message) => showNotice(message),
});

// Everything that follows playback subscribes here.
transport.on("position", (time) => {
  waveform.setTime(time);
  if (transport.playing) {
    waveform.follow(time);
    videoView.advance(time);
  }
  renderTrackTime(time);
});

transport.on("state", (state) => {
  renderTransportState(state);
  if (state === "playing") videoView.start(transport.position);
  else videoView.showFrameAt(transport.position);
});

transport.on("jump", (time) => {
  waveform.resumeFollow(); // a deliberate move brings the view back to the cursor
  if (transport.playing) videoView.start(time);
  else videoView.showFrameAt(time);
});

// Where Space plays from next (see replayOrPause in §12): where playback
// last started, or where it was last moved to.
transport.on("state", (state) => {
  if (state === "playing") returnPoint = transport.position;
  else if (state === "stopped" || state === "ready") returnPoint = 0;
});
transport.on("jump", (time) => {
  returnPoint = time;
});

const hasAudio = () => transport.duration > 0;

/* =====================================================================
 * 9. UI
 * Element lookups, generated markup, and render functions. Rendering
 * only reads state; it never changes it.
 * ===================================================================== */

const dom = {
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
  fileInput: /** @type {HTMLInputElement} */ ($("file")),
  fileName: $("fileName"),
  message: $("message"),
  trackTime: $("trackTime"),
  loopInfo: $("loopInfo"),
  speedScale: $("speedScale"),
  volumeScale: $("volumeScale"),
  playButton: /** @type {HTMLButtonElement} */ ($("play")),
  stopButton: /** @type {HTMLButtonElement} */ ($("stop")),
  stepBackButton: /** @type {HTMLButtonElement} */ ($("stepBack")),
  stepForwardButton: /** @type {HTMLButtonElement} */ ($("stepForward")),
  stepSize: $("stepSize"),
  speedChips: $("speedChips"),
  pitchValue: $("pitchValue"),
  resetPitchButton: $("resetPitch"),
  eqSection: $("eqSection"),
  eqFaders: $("eqFaders"),
  eqToggle: $("eqToggle"),
  resetEqButton: $("resetEq"),
  shortcutList: $("shortcutList"),
};

const speedChips = () => /** @type {HTMLButtonElement[]} */ ([...dom.speedChips.children]);
const transportButtons = () => [dom.playButton, dom.stopButton, dom.stepBackButton, dom.stepForwardButton];

/* ---------- Errors and notices ---------- */

// One message line: in the transport bar, or under the drop zone while
// the welcome screen is up. An error means something failed (red); a
// notice means something works only partly (neutral).
function showMessage(text, kind) {
  const line = dom.app.hidden ? dom.welcomeMessage : dom.message;
  line.textContent = text;
  line.classList.toggle("notice", kind === "notice");
}

const showError = (text) => showMessage(text, "error");
const showNotice = (text) => showMessage(text, "notice");
const clearMessage = () => showMessage("", "notice");

function reportError(error) {
  console.error(error);
  showError(error instanceof AppError ? error.message : `Something went wrong: ${error?.message ?? error}`);
}

// Wraps an event handler so its failures are shown instead of dropped.
const guarded =
  (handler) =>
  (...args) =>
    Promise.resolve()
      .then(() => handler(...args))
      .catch(reportError);

/* ---------- Renderers ---------- */

// The one place that turns the transport state into UI.
function renderTransportState(state) {
  dom.playButton.textContent = state === "playing" ? "❚❚ Pause" : "▶ Play";
  for (const button of transportButtons()) button.disabled = state === "empty";
}

function renderTrackTime(position) {
  const display = `${formatTrackTime(position)} / ${formatTrackTime(transport.duration)}`;
  if (dom.trackTime.textContent !== display) dom.trackTime.textContent = display;
}

// The step readout in the transport bar (the step buttons show arrows).
function renderStepSize() {
  dom.stepSize.textContent = `Step ${formatStepSize(settings.stepSize)} s`;
}

// The loop readout next to the track time; dimmed while the loop is off.
function renderLoopInfo(region) {
  dom.loopInfo.hidden = !region;
  if (!region) return;
  dom.loopInfo.textContent = `Loop ${formatTrackTime(region.start)} – ${formatTrackTime(region.end)}`;
  dom.loopInfo.classList.toggle("disabled", !region.enabled);
}

function renderSpeedChips() {
  for (const chip of speedChips()) {
    chip.classList.toggle("active", Number(chip.dataset.speed) === settings.speed);
  }
}

function renderPitchTotal() {
  dom.pitchValue.textContent = formatPitchTotal(totalSemitones());
}

function renderEqEnabled() {
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
function setLoading(name) {
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
function setLoadingStatus(text, cancelable = false) {
  dom.loadingStatus.textContent = text;
  dom.overlayStatus.textContent = text;
  dom.loadingCancel.hidden = !cancelable;
  dom.overlayCancel.hidden = !cancelable;
}

// Swaps the welcome screen for the player, once, when the first file loads
// (under the loading screen, which setLoading(null) then removes).
function showPlayer() {
  dom.welcome.hidden = true;
  dom.app.hidden = false;
}

/* ---------- Generated markup ---------- */

function element(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function buildSpeedChips() {
  for (const speed of CONFIG.speed.presets) {
    const chip = element("button", { type: "button", className: "chip" }, `${speed}×`);
    chip.dataset.speed = speed;
    dom.speedChips.append(chip);
  }
}

// The labels under the speed and volume sliders, from CONFIG.
function buildScales() {
  const { speed, volume } = CONFIG;
  dom.speedScale.append(element("span", {}, `${speed.min}×`), element("span", {}, `${speed.max}×`));
  for (const percent of [volume.min, CONFIG.volume.initial, volume.max]) {
    dom.volumeScale.append(element("span", {}, formatPercent(percent)));
  }
}

function buildEqFaders() {
  for (const band of CONFIG.eq.bands) {
    dom.eqFaders.append(
      element(
        "div",
        { className: "fader" },
        element("output", { id: `${band.id}Value` }),
        element("input", { id: band.id, type: "range" }),
        element("label", { htmlFor: band.id }, band.label, element("small", {}, formatFrequency(band.frequency))),
      ),
    );
  }
}

/* =====================================================================
 * 10. SETTING CONTROLS
 * Every slider-backed setting is one entry in SLIDERS. setSetting()
 * clamps the value, stores it, updates the slider and readout, then
 * runs the entry's onChange to apply it.
 * ===================================================================== */

function applyEq() {
  engine.setEq(eqGains(), settings.eqEnabled);
}

function applyPitch() {
  renderPitchTotal();
  transport.retune();
}

/**
 * A setting controlled by a range input (see SLIDERS).
 * @typedef {object} SliderSpec
 * @property {string} inputId The <input type="range">.
 * @property {string} readoutId The element showing the formatted value.
 * @property {{ min: number, max: number, step: number }} range From CONFIG.
 * @property {(value: number) => string} format
 * @property {() => void} onChange Applies the new value (audio, other UI).
 */

/** @type {Record<string, SliderSpec>} */
const SLIDERS = {
  speed: {
    inputId: "speed",
    readoutId: "speedValue",
    range: CONFIG.speed,
    format: formatSpeed,
    onChange: () => {
      renderSpeedChips();
      transport.retune();
    },
  },
  volume: {
    inputId: "volume",
    readoutId: "volumeValue",
    range: CONFIG.volume,
    format: formatPercent,
    onChange: () => engine.setVolume(settings.volume / 100),
  },
  semitones: {
    inputId: "semitoneShift",
    readoutId: "semitoneValue",
    range: CONFIG.semitones,
    format: (value) => formatSigned(value, " st"),
    onChange: applyPitch,
  },
  cents: {
    inputId: "centShift",
    readoutId: "centValue",
    range: CONFIG.cents,
    format: (value) => formatSigned(value, " ct"),
    onChange: applyPitch,
  },
  // One per EQ band; the faders themselves are generated by buildEqFaders().
  ...Object.fromEntries(
    CONFIG.eq.bands.map((band) => [
      band.id,
      { inputId: band.id, readoutId: `${band.id}Value`, range: CONFIG.eq.gain, format: formatGain, onChange: applyEq },
    ]),
  ),
};

const sliderInput = (slider) => /** @type {HTMLInputElement} */ ($(slider.inputId));

/**
 * @param {string} key A key of SLIDERS (and of `settings`).
 * @param {number | string} value Clamped to the slider's range.
 */
function setSetting(key, value) {
  const slider = SLIDERS[key];
  const { min, max } = slider.range;

  settings[key] = clamp(Number(value), min, max);
  sliderInput(slider).value = String(settings[key]);
  $(slider.readoutId).textContent = slider.format(settings[key]);
  slider.onChange();
}

function setEqEnabled(enabled) {
  settings.eqEnabled = enabled;
  renderEqEnabled();
  applyEq();
}

function resetPitch() {
  setSetting("semitones", CONFIG.semitones.initial);
  setSetting("cents", CONFIG.cents.initial);
}

function resetEq() {
  for (const band of CONFIG.eq.bands) setSetting(band.id, CONFIG.eq.gain.initial);
}

// ↑ / ↓: the next larger (+1) or smaller (−1) step size; stops at either end.
function changeStepSize(direction) {
  const { sizes } = CONFIG.step;
  const index = sizes.indexOf(settings.stepSize);
  settings.stepSize = sizes[clamp(index + direction, 0, sizes.length - 1)];
  renderStepSize();
}

// Gives each slider its range from CONFIG, shows the current value and
// listens for input.
function initSliders() {
  for (const [key, slider] of Object.entries(SLIDERS)) {
    const input = sliderInput(slider);
    const { min, max, step } = slider.range;
    Object.assign(input, { min: String(min), max: String(max), step: String(step) });

    setSetting(key, settings[key]);
    input.addEventListener(
      "input",
      guarded(() => setSetting(key, input.value)),
    );
  }
}

/* =====================================================================
 * 11. FILE LOADING
 * Nothing about the current media changes until the new file has
 * decoded, so a bad file leaves the previous song or video playable.
 * For video files the audio is decoded as usual while the picture is
 * prepared in parallel; a picture that can't be shown is a notice,
 * not an error.
 * ===================================================================== */

// True while a file loads; the UI is locked, so loads never overlap.
let loading = false;

// Times each phase of a load and logs them in one line with console.debug
// (shown at DevTools' "Verbose" level). Milliseconds.
function createLoadTimer(fileName) {
  const startedAt = performance.now();
  const phases = {};

  return {
    async time(label, work) {
      const phaseStart = performance.now();
      const result = await work();
      phases[label] = Math.round(performance.now() - phaseStart);
      return result;
    },
    done() {
      phases.total = Math.round(performance.now() - startedAt);
      console.debug(`Load timings for “${fileName}”: ${JSON.stringify(phases)}`);
    },
  };
}

// One peak array per channel, for the waveform drawing. Long tracks get
// far fewer peaks per second than short ones (see peaksPerSecondFor).
function computePeaks(audioBuffer) {
  const widestPx = window.screen.width * window.devicePixelRatio;
  const peaksPerSecond = peaksPerSecondFor(audioBuffer.duration, widestPx, CONFIG.waveform);
  const factor = Math.max(1, Math.round(audioBuffer.sampleRate / peaksPerSecond));
  return Array.from({ length: audioBuffer.numberOfChannels }, (_, i) =>
    downsamplePeaks(audioBuffer.getChannelData(i), factor),
  );
}

// Loads `file` into the player; returns notices about what works only partly.
async function loadMediaFile(file) {
  if (file.size > CONFIG.maxFileBytes) {
    throw new AppError(`“${file.name}” is too large to open (the limit is ${formatGigabytes(CONFIG.maxFileBytes)}).`);
  }

  const timer = createLoadTimer(file.name);
  const isVideo = isVideoFile(file, CONFIG.video.extensions);

  const [, waveformAvailable] = await timer.time("init", () => Promise.all([engine.init(), waveform.init()]));
  const picture = isVideo ? timer.time("video", () => videoView.prepare(file)) : Promise.resolve(null);
  const bytes = await timer.time("read", () => file.arrayBuffer());

  let decoded;
  try {
    decoded = await timer.time("decode", () => engine.decode(bytes));
  } catch (error) {
    picture.then((prepared) => videoView.discard(prepared?.video));
    throw new AppError(
      isVideo
        ? `Couldn't read the audio in “${file.name}”. Videos need a soundtrack this app can decode.`
        : `Couldn't open “${file.name}”. It isn't an audio file this app can decode.`,
      error,
    );
  }

  const duration = decoded.duration;
  const peaks = await timer.time("peaks", () => computePeaks(decoded));

  // The decoded samples go to Signalsmith without a copy: transferring
  // moves them to the audio thread and empties `decoded`, which is why
  // the peaks are computed first.
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));

  const prepared = await picture;

  transport.pause();
  // Show the player and switch its layout (video pane shown or hidden)
  // before drawing the waveform: WaveSurfer measures its container when it
  // draws, so it must be visible and at its final size.
  showPlayer();
  if (prepared?.video) videoView.show(prepared.video);
  else videoView.clear();
  // The transfer finishes on the audio thread while the waveform draws.
  await Promise.all([
    timer.time("transfer", () => engine.loadChannels(channels)),
    timer.time("waveform", () => waveform.load(peaks, duration)),
  ]);
  transport.load(duration);
  setLoopRegion(null);
  dom.fileName.textContent = file.name;
  document.title = `TranscriBee — ${file.name}`; // also the window title
  timer.done();

  const notices = [];
  if (isVideo && !prepared?.video) {
    notices.push(`The picture in “${file.name}” can't be shown (${prepared?.reason}), but its audio plays.`);
  }
  if (!waveformAvailable) notices.push("The waveform couldn't be drawn, but playback works.");
  return notices;
}

// Runs `task` (loading `name`) with the loading screen or overlay up, one
// task at a time; its failure is shown as an error.
async function withLoading(name, task) {
  if (loading) return;

  loading = true;
  clearMessage();
  setLoading(name);

  try {
    await task();
  } catch (error) {
    reportError(error);
  } finally {
    loading = false;
    setLoading(null);
    renderTransportState(transport.state);
  }
}

function openFile(file) {
  if (!file) return;
  return withLoading(file.name, async () => showNotice((await loadMediaFile(file)).join(" ")));
}

function bindFileInput() {
  // The welcome screen's button opens the same (hidden) file input.
  dom.welcomeOpen.addEventListener("click", () => dom.fileInput.click());

  dom.fileInput.addEventListener("change", () => {
    const file = dom.fileInput.files?.[0];
    // Clear it so choosing the same file again still fires "change".
    dom.fileInput.value = "";
    openFile(file);
  });
}

function bindFileDrop() {
  // Without preventDefault, Electron navigates to a dropped file.
  window.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (!loading) document.body.classList.add("dragging");
  });

  window.addEventListener("dragleave", (event) => {
    if (event.relatedTarget === null) document.body.classList.remove("dragging");
  });

  window.addEventListener("drop", (event) => {
    event.preventDefault();
    document.body.classList.remove("dragging");
    openFile(event.dataTransfer?.files?.[0]);
  });
}

/* ---------- Downloading a link ---------- */

/**
 * The bridge preload.js exposes; missing outside Electron.
 * @typedef {object} DownloadProgress
 * @property {"setup" | "update" | "download" | "join"} stage
 * @property {number} [part]  1-based; video downloads picture, then sound
 * @property {number} [parts]
 * @property {number | null} [fraction]
 * @property {number | null} [eta]  seconds
 * @property {string} [title]  the video's, once known
 *
 * @typedef {{ ok: true, name: string, path: string, bytes: Uint8Array }
 *   | { ok: false, canceled: boolean, error: string }} DownloadResult
 *
 * @typedef {object} DownloadBridge
 * @property {(url: string, kind: string) => Promise<DownloadResult>} download
 * @property {() => Promise<void>} cancelDownload
 * @property {(callback: (progress: DownloadProgress) => void) => () => void} onDownloadProgress
 */
const downloads = /** @type {DownloadBridge | undefined} */ (/** @type {any} */ (window).transcribee);

let downloadKind = "audio"; // the dialog's last choice, for this session

/**
 * @param {DownloadProgress} progress
 * @param {string} kind
 */
function describeDownload({ stage, part = 1, parts = 1, fraction, eta }, kind) {
  const percent = fraction == null ? "" : ` ${Math.floor(fraction * 100)} %`;
  if (stage === "setup") return `Setting up the downloader (first time only)…${percent}`;
  if (stage === "update") return "Updating the downloader…";
  if (stage === "join") return kind === "video" ? "Joining picture and sound…" : "Saving…";
  const what = parts === 1 ? "Downloading" : part === 1 ? "Downloading the picture" : "Downloading the sound";
  return `${what}…${percent}${eta ? ` · ${formatEta(eta)} left` : ""}`;
}

// Downloads `url` (in the main process) and opens the file. Canceling just
// returns to what was there before.
function downloadLink(url, kind) {
  if (!downloads) return;
  return withLoading(url, async () => {
    setLoadingStatus(describeDownload({ stage: "download", fraction: 0 }, kind), true);
    const stopListening = downloads.onDownloadProgress((progress) => {
      setLoadingStatus(describeDownload(progress, kind), progress.stage !== "join");
      if (progress.title) dom.loadingFileName.textContent = dom.overlayTitle.textContent = progress.title;
    });
    let result;
    try {
      result = await downloads.download(url, kind);
    } finally {
      stopListening();
    }
    if (!result.ok) {
      if (result.canceled) return;
      throw new AppError(result.error);
    }

    setLoadingStatus("Loading");
    dom.loadingFileName.textContent = result.name;
    const notices = await loadMediaFile(new File([result.bytes], result.name));
    showNotice([`Saved as ${result.path}.`, ...notices].join(" "));
  });
}

function openDownloadDialog(url = "") {
  if (!downloads || loading || dom.downloadDialog.open) return;
  dom.downloadUrl.value = url;
  const kind = /** @type {HTMLInputElement} */ (dom.downloadForm.elements.namedItem("downloadKind"));
  /** @type {RadioNodeList} */ (/** @type {unknown} */ (kind)).value = downloadKind;
  dom.downloadDialog.showModal();
  dom.downloadUrl.focus();
  dom.downloadUrl.select();
}

const looksLikeLink = (text) => /^https?:\/\/\S+$/i.test(text.trim());

function bindDownloads() {
  if (!downloads) return; // not in Electron: no download buttons
  dom.welcomeDownload.hidden = false;
  dom.downloadButton.hidden = false;
  onClick(dom.welcomeDownload, () => openDownloadDialog());
  onClick(dom.downloadButton, () => openDownloadDialog());
  onClick(dom.downloadClose, () => dom.downloadDialog.close());
  onClick(dom.loadingCancel, () => downloads.cancelDownload());
  onClick(dom.overlayCancel, () => downloads.cancelDownload());

  dom.downloadForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const kind = new FormData(dom.downloadForm).get("downloadKind");
    downloadKind = kind === "video" ? "video" : "audio";
    dom.downloadDialog.close();
    guarded(downloadLink)(dom.downloadUrl.value.trim(), downloadKind);
  });

  // Pasting a link anywhere but a text field opens the dialog with it.
  window.addEventListener("paste", (event) => {
    if (event.target instanceof HTMLElement && isTextField(event.target)) return;
    const text = event.clipboardData?.getData("text") ?? "";
    if (!looksLikeLink(text)) return;
    event.preventDefault();
    openDownloadDialog(text.trim());
  });
}

/* =====================================================================
 * 12. PLAYBACK ACTIONS
 * What buttons and shortcuts call. Each is synchronous: playback is
 * scheduled on the audio clock, so nothing needs to be awaited.
 * ===================================================================== */

function play() {
  // Only needed if the system suspended the audio; scheduled playback
  // simply waits on the audio clock until it runs.
  engine.resume()?.catch(reportError);
  transport.play();
}

// `event` (optional) is the key or click that asked for it: pausing uses its
// timestamp to stop exactly at what was being heard at that moment.
const pause = (event) => transport.pause(event?.timeStamp);
const stop = () => transport.stop();
// Pause, or resume from where playback is now (comma).
const togglePlay = (event) => (transport.playing ? pause(event) : play());
// Moves the cursor one step (settings.stepSize) back or forward.
const step = (direction) => transport.seek(transport.position + direction * settings.stepSize);
const stepBack = () => step(-1);
const stepForward = () => step(1);

// Where you last started listening: where playback last started, or where
// it was last moved to (click, step, loop wrap); 0 after Stop. Kept up to
// date by the transport listeners in §8.
let returnPoint = null;

// Pause, or play again from where you started listening (Space and the
// Play button, like Transcribe!). The cursor stays where it paused, so
// the spot stays visible; a click or step while paused moves the start.
function replayOrPause(event) {
  if (transport.playing) return pause(event);
  // Read first: the seek below moves returnPoint itself.
  const from = returnPoint;
  if (from !== null && from !== transport.position) transport.seek(from);
  play();
}

// Play-while-held: keys currently held, and whether playback was already
// running when the first one went down (then releasing keeps it running).
const heldKeys = new Set();
let playingBeforeHold = false;

function holdToPlay(event) {
  if (heldKeys.size === 0) playingBeforeHold = transport.playing;
  heldKeys.add(event.code);
  play();
}

function releaseHold(event) {
  if (!heldKeys.delete(event.code)) return;
  if (heldKeys.size === 0 && !playingBeforeHold) pause(event);
}

/* ---------- A–B loop ---------- */

/** @typedef {import("./core/timeline.js").LoopRegion} LoopRegion */
/** @type {LoopRegion | null} */
let loopRegion = null;

/** @param {LoopRegion | null} region Too short (or null) removes the loop. */
function setLoopRegion(region) {
  const valid = region && region.end - region.start >= CONFIG.loop.minSeconds;
  loopRegion = valid ? { start: region.start, end: region.end, enabled: region.enabled } : null;
  transport.setLoop(loopRegion?.enabled ? loopRegion : null);
  waveform.setLoop(loopRegion);
  renderLoopInfo(loopRegion);
}

// [ and ]: move one end of the loop to the cursor, keeping the other end
// if it still makes a loop, and turn the loop on.
function setLoopStart() {
  const start = transport.position;
  const end = loopRegion && loopRegion.end > start ? loopRegion.end : transport.duration;
  setLoopRegion({ start, end, enabled: true });
}

function setLoopEnd() {
  const end = transport.position;
  const start = loopRegion && loopRegion.start < end ? loopRegion.start : 0;
  setLoopRegion({ start, end, enabled: true });
}

const toggleLoop = () => loopRegion && setLoopRegion({ ...loopRegion, enabled: !loopRegion.enabled });
const clearLoop = () => setLoopRegion(null);

// A click handler whose failures are shown to the user (see guarded).
const onClick = (element, handler) => element.addEventListener("click", guarded(handler));

function bindControls() {
  onClick(dom.playButton, replayOrPause);
  onClick(dom.stopButton, stop);
  onClick(dom.stepBackButton, stepBack);
  onClick(dom.stepForwardButton, stepForward);

  for (const chip of speedChips()) {
    onClick(chip, () => setSetting("speed", chip.dataset.speed));
  }

  onClick(dom.resetPitchButton, resetPitch);
  onClick(dom.resetEqButton, resetEq);
  onClick(dom.eqToggle, () => setEqEnabled(!settings.eqEnabled));
}

/* =====================================================================
 * 13. KEYBOARD SHORTCUTS
 * Modelled on the defaults of Seventh String's Transcribe!. The legend
 * at the bottom of the window is rendered from SHORTCUTS.
 *
 *   codes   KeyboardEvent.code values (physical keys, any layout)
 *   shift   true if the shortcut is Shift + the key (optional)
 *   keys    labels for the legend, one per code
 *   down    called on key press, with the KeyboardEvent
 *   up      called on key release (optional), with the KeyboardEvent
 *   repeat  whether holding the key keeps firing `down`
 * Shortcuts only fire when a track is loaded and nothing is loading.
 * ===================================================================== */

/**
 * @typedef {object} Shortcut
 * @property {string[]} codes
 * @property {boolean} [shift]
 * @property {string[]} keys
 * @property {string} description
 * @property {(event: KeyboardEvent) => void} down
 * @property {(event: KeyboardEvent) => void} [up]
 * @property {boolean} [repeat]
 */

/** @type {Shortcut[]} */
const SHORTCUTS = [
  {
    codes: ["Space"],
    keys: ["Space"],
    description: "Play / pause (replays from where you started)",
    down: replayOrPause,
  },
  { codes: ["Comma"], keys: [","], description: "Pause / resume here", down: togglePlay },
  { codes: ["Period"], keys: ["."], description: "Stop", down: stop },
  { codes: ["KeyZ", "Semicolon"], keys: ["Z", ";"], description: "Play while held", down: holdToPlay, up: releaseHold },
  { codes: ["ArrowLeft"], keys: ["←"], description: "Step back (hold to rewind)", repeat: true, down: stepBack },
  {
    codes: ["ArrowRight"],
    keys: ["→"],
    description: "Step forward (hold to fast-forward)",
    repeat: true,
    down: stepForward,
  },
  { codes: ["ArrowUp"], keys: ["↑"], description: "Larger step", down: () => changeStepSize(1) },
  { codes: ["ArrowDown"], keys: ["↓"], description: "Smaller step", down: () => changeStepSize(-1) },
  { codes: ["BracketLeft"], keys: ["["], description: "Loop start", down: setLoopStart },
  { codes: ["BracketRight"], keys: ["]"], description: "Loop end", down: setLoopEnd },
  { codes: ["KeyL"], keys: ["L"], description: "Loop on / off", down: toggleLoop },
  { codes: ["KeyL"], shift: true, keys: ["L"], description: "Clear loop", down: clearLoop },
];

// Shortcuts are plain keys or Shift + key; presses with Ctrl, Alt or Meta
// are left to the system. A release matches by key alone, so pressing
// Shift while holding a play-while-held key can't leave it playing.
function findShortcut(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  const isRelease = event.type === "keyup";
  return SHORTCUTS.find(
    (shortcut) => shortcut.codes.includes(event.code) && (isRelease || Boolean(shortcut.shift) === event.shiftKey),
  );
}

const isTextField = (target) =>
  target.isContentEditable ||
  target.tagName === "TEXTAREA" ||
  (target.tagName === "INPUT" && !["range", "button", "checkbox", "file"].includes(target.type));

// A slider reached with Tab keeps its arrow keys, for keyboard-only use.
// A slider that was clicked doesn't: after dragging the speed, ← / → still
// step the cursor. (:focus-visible can't tell these apart: Chromium turns
// it on for the focused element as soon as any key is pressed.)
let clickedElement = null; // last element pressed with the pointer; Tab clears it

const isKeyboardFocusedSlider = (target) =>
  target.tagName === "INPUT" && target.type === "range" && target !== clickedElement;

function handleShortcutKey(event) {
  if (loading || dom.downloadDialog.open || isTextField(event.target)) return;
  if (event.code.startsWith("Arrow") && isKeyboardFocusedSlider(event.target)) return;

  const shortcut = findShortcut(event);
  if (!shortcut) return;

  // Also stops e.g. Space from clicking a focused button.
  event.preventDefault();

  const handler = event.type === "keydown" ? shortcut.down : shortcut.up;
  if (!handler || !hasAudio()) return;
  if (event.type === "keydown" && event.repeat && !shortcut.repeat) return;

  guarded(handler)(event);
}

function renderShortcutLegend() {
  for (const shortcut of SHORTCUTS) {
    const item = element("li");
    if (shortcut.shift) item.append(element("kbd", {}, "Shift"), "+");
    shortcut.keys.forEach((key, i) => {
      if (i > 0) item.append("/");
      item.append(element("kbd", {}, key));
    });
    item.append(shortcut.description);
    dom.shortcutList.append(item);
  }
}

function bindShortcuts() {
  window.addEventListener("pointerdown", (event) => (clickedElement = event.target), { capture: true });
  window.addEventListener("keydown", (event) => event.key === "Tab" && (clickedElement = null), { capture: true });
  window.addEventListener("keydown", handleShortcutKey);
  window.addEventListener("keyup", handleShortcutKey);

  // Key releases are missed while the window is unfocused.
  window.addEventListener("blur", () => {
    for (const code of [...heldKeys]) guarded(releaseHold)({ code, timeStamp: performance.now() });
  });
}

/* =====================================================================
 * 14. STARTUP
 * ===================================================================== */

function start() {
  // Warm up so the first file opens faster: start the audio engine (which
  // compiles the Signalsmith worklet) and fetch the waveform and video code
  // now. Failures are reported when a file is opened, which retries them.
  engine.init().catch((error) => console.warn("Audio engine warm-up failed:", error));
  waveform.preload().catch((error) => console.warn("Waveform warm-up failed:", error));
  videoView.preload().catch((error) => console.warn("Video warm-up failed:", error));

  buildSpeedChips();
  buildScales();
  buildEqFaders();
  renderShortcutLegend();

  initSliders();
  setEqEnabled(settings.eqEnabled);
  renderTransportState(transport.state);
  renderTrackTime(0);
  renderStepSize();

  bindControls();
  bindFileInput();
  bindFileDrop();
  bindDownloads();
  bindShortcuts();
  dom.welcomeOpen.focus();
}

start();
