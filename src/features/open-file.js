/* =====================================================================
 * OPENING FILES
 * Loading a song or video into the player; which file to open, and the
 * session it starts (or the project it belongs to), are features/project's.
 * Nothing about the current media changes until the new file has
 * decoded, so a bad file (or Cancel) leaves the previous song or video
 * playable, with its settings. A file that opens starts fresh: no loop or
 * marks, and the default speed, pitch, volume and EQ (the step size
 * stays). The audio is decoded in chunks off the main thread
 * (audio/decoder.js), with progress; a track that wouldn't fit in the
 * available memory is refused before decoding (see checkMemory). For video files the picture is prepared in
 * parallel; a picture that can't be shown is a notice, not an error.
 * ===================================================================== */

import { DecodeFailure, decodeFile } from "../audio/decoder.js";
import { CONFIG } from "../config.js";
import { player } from "../context.js";
import { AppError } from "../core/errors.js";
import {
  decodedBytes,
  fileExtension,
  fitsInMemory,
  isVideoFile,
  peaksPerSecondFor,
  workerCount,
} from "../core/media.js";
import { formatDuration, formatMemory } from "../core/format.js";
import { resetSoundSettings } from "../ui/controls.js";
import {
  clearMessage,
  dom,
  guarded,
  onClick,
  renderTransportState,
  reportError,
  setLoading,
  setLoadingStatus,
  showPlayer,
} from "../ui/dom.js";
import { setLoopRegion } from "./playback.js";
import { resetMarks } from "./marks.js";

// The current load, while one runs; the UI is locked, so loads never
// overlap. Cancel aborts it.
/** @type {AbortController | null} */
let loading = null;

export const isLoading = () => loading !== null;

const cancelLoading = () => loading?.abort();

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
    return (await /** @type {any} */ (window).scribee?.availableMemory?.()) ?? null;
  } catch {
    return null;
  }
}

// Refuses a file whose decoded sound (plus, for a video, its proxy)
// wouldn't fit in memory, before decoding (after it, on the fallback
// that decodes the whole file at once: audio/decoder.js). Neither file is ever read whole,
// so its size on disk doesn't matter.
async function checkMemory(media, info, isVideo) {
  const { bitrate, overview } = CONFIG.video.proxy;
  const overviewFrames = Math.min(info.duration / overview.spacingSeconds, overview.maxFrames);
  const proxyBytes = isVideo ? (info.duration * bitrate + overviewFrames * overview.bitrate) / 8 : 0;
  const needed = decodedBytes(info.duration, info.sampleRate, info.channels) + proxyBytes;
  const available = await availableMemory();
  if (!fitsInMemory(needed, available, CONFIG.audio.maxMemoryShare)) {
    throw new AppError(
      `“${media.name}” is too long to open: its ${isVideo ? "sound and picture need" : "sound needs"} ` +
        `about ${formatMemory(needed)} of memory, ` +
        `and ${formatMemory(available)} is available. Closing other programs may help.`,
    );
  }
}

// A decoding failure, in words for the user.
function explainDecodeFailure(error, media, isVideo) {
  if (!(error instanceof DecodeFailure)) return error;
  if (error.kind === "no-audio") {
    return new AppError(`“${media.name}” has no sound, so there's nothing to play.`, error);
  }
  if (error.kind === "out-of-memory") {
    return new AppError(`“${media.name}” is too long to open: there isn't enough memory for its sound.`, error);
  }
  return new AppError(
    isVideo
      ? `Couldn't read the audio in “${media.name}”. Videos need a soundtrack this app can decode.`
      : `Couldn't open “${media.name}”. It isn't an audio file this app can decode.`,
    error,
  );
}

/**
 * Loads `media` (a File, or a download's { name, url }: core/media.js)
 * into the player; returns notices about what works only partly. Aborting
 * `signal` (Cancel) rejects with an AbortError and changes nothing.
 * @param {import("../core/media.js").Media} media
 * @param {AbortSignal} [signal]
 */
export async function loadMediaFile(media, signal) {
  const isVideo = isVideoFile(media, CONFIG.video.extensions);
  const timer = createLoadTimer(media.name);
  const [, waveformAvailable] = await timer.time("init", () =>
    Promise.all([player.engine.init(), player.waveform.init()]),
  );
  const picture = isVideo ? timer.time("video", () => player.videoView.prepare(media)) : Promise.resolve(null);

  let decoded;
  try {
    decoded = await timer.time("decode", () =>
      decodeFile(media, {
        signal,
        prepare: async (info) => {
          await checkMemory(media, info, isVideo);
          return {
            peakFactor: peakFactorFor(info),
            workers: workerCount(info.duration, navigator.hardwareConcurrency, CONFIG.audio.parallel),
          };
        },
        onProgress: (fraction) => setLoadingStatus(`Loading ${Math.floor(fraction * 100)} %`, true),
      }),
    );
  } catch (error) {
    picture.then((prepared) => player.videoView.discard(prepared?.video));
    throw isAbort(error) ? error : explainDecodeFailure(error, media, isVideo);
  }
  setLoadingStatus("Loading");

  const prepared = await picture;
  // Its proxy's overview, started while the sound decoded: then dragging
  // anywhere shows a picture at once (see video/view.js). Waits a little
  // at most; the rest is built in the background.
  await timer.time("overview", () =>
    player.videoView.overviewReady(prepared?.video, CONFIG.video.proxy.overview.waitMs, signal, (share) =>
      setLoadingStatus(`Preparing the picture ${Math.floor(share * 100)} %`, true),
    ),
  );
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
    timer.time("transfer", () => player.engine.loadPieces(decoded.pieces)),
    timer.time("waveform", () => player.waveform.load(decoded.levels, decoded.duration)),
  ]);
  player.transport.load(decoded.duration);
  // A new file starts fresh: no loop or marks, and default speed, pitch,
  // volume and EQ.
  setLoopRegion(null);
  resetMarks(decoded.duration);
  resetSoundSettings();
  dom.fileName.textContent = media.name;
  dom.fileName.title = media.name;
  // Its length and kind, and an icon for audio or video.
  const kind = fileExtension(media.name).toUpperCase();
  dom.fileMeta.textContent = `${formatDuration(decoded.duration)} · ${kind}${isVideo ? " video" : ""}`;
  dom.fileInfo.classList.toggle("video", isVideo);
  dom.fileInfo.classList.add("loaded");
  document.title = `ScriBee — ${media.name}`; // also the window title
  timer.done();

  const notices = [];
  if (isVideo && !prepared?.video) {
    notices.push(`The picture in “${media.name}” can't be shown (${prepared?.reason}), but its audio plays.`);
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

// The Cancel buttons on the loading screen and overlay, for files and
// downloads alike.
export function bindLoadCancel() {
  onClick(dom.loadingCancel, cancelLoading);
  onClick(dom.overlayCancel, cancelLoading);
}

// The Open buttons and dropping a file call `open` with the File (a song,
// a video or a project: features/project decides).
/** @param {(file: File | undefined) => unknown} open */
export function bindFileInput(open) {
  // The welcome screen's button opens the same (hidden) file input.
  dom.welcomeOpen.addEventListener("click", () => dom.fileInput.click());

  dom.fileInput.addEventListener("change", () => {
    const file = dom.fileInput.files?.[0];
    // Clear it so choosing the same file again still fires "change".
    dom.fileInput.value = "";
    if (!loading) guarded(open)(file); // one file at a time (the loading screen is up)
  });
}

// What a dragged file looks like before it's dropped: only its type is
// readable then, not its name, so a project (.sbee) is just "file".
/** @param {DataTransfer} transfer */
function dragged(transfer) {
  const files = [...transfer.items].filter((item) => item.kind === "file");
  const type = files[0]?.type ?? "";
  const kind = type.startsWith("audio/") ? "song" : type.startsWith("video/") ? "video" : "file";
  const more = files.length > 1 ? ` (the first of ${files.length})` : "";
  return { kind, prompt: `Drop to open this ${kind}${more}` };
}

// While a file is dragged over the window, the welcome screen's drop card
// or the player's overlay says what a drop will open (style.css shows
// them from body.dragging and data-drop-kind). Other drags (text, links)
// are left alone.
/** @param {(file: File | undefined) => unknown} open */
export function bindFileDrop(open) {
  const stop = () => {
    document.body.classList.remove("dragging");
    delete document.body.dataset.dropKind;
  };

  // Without preventDefault, Electron navigates to a dropped file.
  window.addEventListener("dragover", (event) => {
    event.preventDefault();
    const transfer = event.dataTransfer;
    if (loading || !transfer?.types.includes("Files")) return;
    const { kind, prompt } = dragged(transfer);
    if (document.body.dataset.dropKind !== kind) {
      document.body.dataset.dropKind = kind;
      dom.welcomeDropText.textContent = prompt;
      dom.dropOverlayText.textContent = prompt;
    }
    document.body.classList.add("dragging");
  });

  window.addEventListener("dragleave", (event) => {
    if (event.relatedTarget === null) stop();
  });

  window.addEventListener("drop", (event) => {
    event.preventDefault();
    stop();
    // Not while another file loads: before asking about unsaved changes
    // or opening a project, not just when loading would refuse it.
    if (!loading) guarded(open)(event.dataTransfer?.files?.[0]);
  });
}
