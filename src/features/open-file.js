/* =====================================================================
 * OPENING FILES
 * Nothing about the current media changes until the new file has
 * decoded, so a bad file (or Cancel) leaves the previous song or video
 * playable, with its settings. A file that opens starts fresh: no loop,
 * and the default speed, pitch, volume and EQ (the step size stays).
 * The audio is decoded in chunks off the main thread (audio/decoder.js),
 * with progress; a track that wouldn't fit in the available memory is
 * refused before decoding. For video files the picture is prepared in
 * parallel; a picture that can't be shown is a notice, not an error.
 * ===================================================================== */

import { DecodeFailure, decodeFile } from "../audio/decoder.js";
import { CONFIG } from "../config.js";
import { player } from "../context.js";
import { AppError } from "../core/errors.js";
import { isVideoFile } from "../core/files.js";
import { formatMemory } from "../core/format.js";
import { decodedBytes, fitsInMemory } from "../core/memory.js";
import { peaksPerSecondFor } from "../core/peaks.js";
import { resetSoundSettings } from "../ui/controls.js";
import {
  clearMessage,
  dom,
  onClick,
  renderTransportState,
  reportError,
  setLoading,
  setLoadingStatus,
  showNotice,
  showPlayer,
} from "../ui/dom.js";
import { setLoopRegion } from "./loop.js";

// The current load, while one runs; the UI is locked, so loads never
// overlap. Cancel aborts it.
/** @type {AbortController | null} */
let loading = null;

export const isLoading = () => loading !== null;

export const cancelLoading = () => loading?.abort();

const isAbort = (error) => error instanceof DOMException && error.name === "AbortError";

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

// Samples per waveform peak: long tracks get far fewer peaks per second
// than short ones (see peaksPerSecondFor).
function peakFactorFor({ duration, sampleRate }) {
  const widestPx = window.screen.width * window.devicePixelRatio;
  const peaksPerSecond = peaksPerSecondFor(duration, widestPx, CONFIG.waveform);
  return Math.max(1, Math.round(sampleRate / peaksPerSecond));
}

// Memory the system has available (main process), or null if unknown.
async function availableMemory() {
  try {
    return (await /** @type {any} */ (window).transcribee?.availableMemory?.()) ?? null;
  } catch {
    return null;
  }
}

// Refuses a file whose decoded sound (plus, for a video, its proxy)
// wouldn't fit in memory, before decoding. Neither file is ever read whole,
// so its size on disk doesn't matter.
async function checkMemory(file, info, isVideo) {
  const proxyBytes = isVideo ? (info.duration * CONFIG.video.proxy.bitrate) / 8 : 0;
  const needed = decodedBytes(info.duration, info.sampleRate, info.channels) + proxyBytes;
  const available = await availableMemory();
  if (!fitsInMemory(needed, available, CONFIG.audio.maxMemoryShare)) {
    throw new AppError(
      `“${file.name}” is too long to open: its sound needs about ${formatMemory(needed)} of memory, ` +
        `and ${formatMemory(available)} is available. Closing other programs may help.`,
    );
  }
}

// A decoding failure, in words for the user.
function explainDecodeFailure(error, file, isVideo) {
  if (!(error instanceof DecodeFailure)) return error;
  if (error.kind === "no-audio") {
    return new AppError(`“${file.name}” has no sound, so there's nothing to play.`, error);
  }
  if (error.kind === "out-of-memory") {
    return new AppError(`“${file.name}” is too long to open: there isn't enough memory for its sound.`, error);
  }
  return new AppError(
    isVideo
      ? `Couldn't read the audio in “${file.name}”. Videos need a soundtrack this app can decode.`
      : `Couldn't open “${file.name}”. It isn't an audio file this app can decode.`,
    error,
  );
}

/**
 * Loads `file` into the player; returns notices about what works only
 * partly. Aborting `signal` (Cancel) rejects with an AbortError and
 * changes nothing.
 * @param {File} file
 * @param {AbortSignal} [signal]
 */
export async function loadMediaFile(file, signal) {
  const isVideo = isVideoFile(file, CONFIG.video.extensions);
  const timer = createLoadTimer(file.name);
  const [, waveformAvailable] = await timer.time("init", () =>
    Promise.all([player.engine.init(), player.waveform.init()]),
  );
  const picture = isVideo ? timer.time("video", () => player.videoView.prepare(file)) : Promise.resolve(null);

  let decoded;
  try {
    decoded = await timer.time("decode", () =>
      decodeFile(file, {
        signal,
        prepare: async (info) => {
          await checkMemory(file, info, isVideo);
          return peakFactorFor(info);
        },
        onProgress: (fraction) => setLoadingStatus(`Loading ${Math.floor(fraction * 100)} %`, true),
      }),
    );
  } catch (error) {
    picture.then((prepared) => player.videoView.discard(prepared?.video));
    throw isAbort(error) ? error : explainDecodeFailure(error, file, isVideo);
  }
  setLoadingStatus("Loading");

  const prepared = await picture;
  if (signal?.aborted) {
    player.videoView.discard(prepared?.video);
    throw new DOMException("Loading was canceled.", "AbortError");
  }

  // From here on the new file replaces the current one.
  player.transport.pause();
  // A track plays in a context at its own rate (see audio/engine.js).
  await timer.time("rate", () => player.engine.useSampleRate(decoded.sampleRate));
  // Show the player and switch its layout (video pane shown or hidden)
  // before drawing the waveform: WaveSurfer measures its container when it
  // draws, so it must be visible and at its final size.
  showPlayer();
  if (prepared?.video) player.videoView.show(prepared.video);
  else player.videoView.clear();
  // The samples move to the audio thread (no copy) while the waveform draws.
  await Promise.all([
    timer.time("transfer", () => player.engine.loadChannels(decoded.channels)),
    timer.time("waveform", () => player.waveform.load(decoded.peaks, decoded.duration)),
  ]);
  player.transport.load(decoded.duration);
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
// task at a time; its failure is shown as an error, and Cancel (an
// AbortError) quietly returns to what was there before. `task` gets the
// AbortSignal that Cancel triggers.
/** @param {string} name @param {(signal: AbortSignal) => Promise<void>} task */
export async function withLoading(name, task) {
  if (loading) return;

  const controller = new AbortController();
  loading = controller;
  clearMessage();
  setLoading(name);

  try {
    await task(controller.signal);
  } catch (error) {
    if (!isAbort(error)) reportError(error);
  } finally {
    loading = null;
    setLoading(null);
    renderTransportState(player.transport.state);
  }
}

export function openFile(file) {
  if (!file) return;
  return withLoading(file.name, async (signal) => showNotice((await loadMediaFile(file, signal)).join(" ")));
}

// The Cancel buttons on the loading screen and overlay, for files and
// downloads alike.
export function bindLoadCancel() {
  onClick(dom.loadingCancel, cancelLoading);
  onClick(dom.overlayCancel, cancelLoading);
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
