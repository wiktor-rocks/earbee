/* =====================================================================
 * OPENING FILES
 * Nothing about the current media changes until the new file has
 * decoded, so a bad file leaves the previous song or video playable, with
 * its settings. A file that opens starts fresh: no loop, and the default
 * speed, pitch, volume and EQ (the step size stays).
 * For video files the audio is decoded as usual while the picture is
 * prepared in parallel; a picture that can't be shown is a notice,
 * not an error.
 * ===================================================================== */

import { CONFIG } from "../config.js";
import { player } from "../context.js";
import { AppError } from "../core/errors.js";
import { isVideoFile } from "../core/files.js";
import { formatGigabytes } from "../core/format.js";
import { downsamplePeaks, peaksPerSecondFor } from "../core/peaks.js";
import { resetSoundSettings } from "../ui/controls.js";
import { clearMessage, dom, renderTransportState, reportError, setLoading, showNotice, showPlayer } from "../ui/dom.js";
import { setLoopRegion } from "./loop.js";

// True while a file loads; the UI is locked, so loads never overlap.
let loading = false;

export const isLoading = () => loading;

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
export async function loadMediaFile(file) {
  if (file.size > CONFIG.maxFileBytes) {
    throw new AppError(`“${file.name}” is too large to open (the limit is ${formatGigabytes(CONFIG.maxFileBytes)}).`);
  }

  const timer = createLoadTimer(file.name);
  const isVideo = isVideoFile(file, CONFIG.video.extensions);

  const [, waveformAvailable] = await timer.time("init", () =>
    Promise.all([player.engine.init(), player.waveform.init()]),
  );
  const picture = isVideo ? timer.time("video", () => player.videoView.prepare(file)) : Promise.resolve(null);
  const bytes = await timer.time("read", () => file.arrayBuffer());

  let decoded;
  try {
    decoded = await timer.time("decode", () => player.engine.decode(bytes));
  } catch (error) {
    picture.then((prepared) => player.videoView.discard(prepared?.video));
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

  player.transport.pause();
  // Show the player and switch its layout (video pane shown or hidden)
  // before drawing the waveform: WaveSurfer measures its container when it
  // draws, so it must be visible and at its final size.
  showPlayer();
  if (prepared?.video) player.videoView.show(prepared.video);
  else player.videoView.clear();
  // The transfer finishes on the audio thread while the waveform draws.
  await Promise.all([
    timer.time("transfer", () => player.engine.loadChannels(channels)),
    timer.time("waveform", () => player.waveform.load(peaks, duration)),
  ]);
  player.transport.load(duration);
  // A new file starts fresh: no loop, and default speed, pitch, volume and EQ.
  setLoopRegion(null);
  resetSoundSettings();
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
export async function withLoading(name, task) {
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
    renderTransportState(player.transport.state);
  }
}

export function openFile(file) {
  if (!file) return;
  return withLoading(file.name, async () => showNotice((await loadMediaFile(file)).join(" ")));
}

export function bindFileInput() {
  // The welcome screen's button opens the same (hidden) file input.
  dom.welcomeOpen.addEventListener("click", () => dom.fileInput.click());

  dom.fileInput.addEventListener("change", () => {
    const file = dom.fileInput.files?.[0];
    // Clear it so choosing the same file again still fires "change".
    dom.fileInput.value = "";
    openFile(file);
  });
}

export function bindFileDrop() {
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
