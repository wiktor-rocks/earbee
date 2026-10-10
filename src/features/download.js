// Downloading a link (YouTube): the From YouTube dialog (index.html; it
// looks like Settings), pasting a link, and progress on the loading screen. Words instead of a link search (features/search.js),
// and the result picked downloads like a link. The download itself runs in the main process
// (electron/downloader.js), reached through window.transcribee
// (electron/preload.js); the file then opens like any other.
import { AppError } from "../core/errors.js";
import { formatEta } from "../core/format.js";
import { dom, guarded, onClick, setLoadingStatus, showNotice } from "../ui/dom.js";
import { defaultPaths, getPrefs, setPref } from "../ui/prefs.js";
import { isTextField } from "../ui/shortcuts.js";
import { isLoading, withLoading } from "./open-file.js";
import { confirmUnsaved, loadMedia } from "./project/index.js";
import { bindSearch, looksLikeLink, resetSearch, searchFor } from "./search.js";

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
 * `url` serves the saved file to the page in pieces (electron/media-files.js).
 * `chapters`: the ones the uploader gave the video, in seconds ([] if none).
 * @typedef {{ ok: true, name: string, path: string, url: string,
 *   chapters: { start: number, end: number, title: string }[] }
 *   | { ok: false, canceled: boolean, error: string }} DownloadResult
 *
 * @typedef {object} DownloadBridge
 * @property {(url: string, kind: string) => Promise<DownloadResult>} download
 * @property {() => Promise<void>} cancelDownload
 * @property {(callback: (progress: DownloadProgress) => void) => () => void} onDownloadProgress
 */
const downloads = /** @type {DownloadBridge | undefined} */ (/** @type {any} */ (window).transcribee);

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
async function downloadLink(url, kind) {
  if (!downloads || !(await confirmUnsaved())) return;
  const withChapters = dom.downloadChapters.checked; // as the dialog was left
  return withLoading(url, async (signal) => {
    setLoadingStatus(describeDownload({ stage: "download", fraction: 0 }, kind), true);
    const cancel = () => downloads.cancelDownload();
    signal.addEventListener("abort", cancel);
    const stopListening = downloads.onDownloadProgress((progress) => {
      setLoadingStatus(describeDownload(progress, kind), progress.stage !== "join");
      if (progress.title) dom.loadingFileName.textContent = dom.overlayTitle.textContent = progress.title;
    });
    let result;
    try {
      result = await downloads.download(url, kind);
    } finally {
      stopListening();
      signal.removeEventListener("abort", cancel);
    }
    if (!result.ok) {
      if (result.canceled) return;
      throw new AppError(result.error);
    }

    setLoadingStatus("Loading");
    dom.loadingFileName.textContent = result.name;
    // Read from disk by URL, never whole (see electron/media-files.js).
    const notices = await loadMedia({ name: result.name, url: result.url }, signal, {
      chapters: withChapters ? (result.chapters ?? []) : [],
    });
    showNotice([`Saved as ${result.path}.`, ...notices].join(" "));
  });
}

// Starts on the kind set in Settings › Downloads, and says where the file
// will go and the best video quality, from there too.
export function openDownloadDialog(url = "") {
  // Not over another dialog (Settings) or while something loads.
  if (!downloads || isLoading() || document.querySelector("dialog[open]")) return;
  const { kind, folder, maxHeight, chapters } = getPrefs("downloads");
  dom.downloadChapters.checked = chapters;
  dom.downloadUrl.value = url;
  const radios = /** @type {RadioNodeList} */ (dom.downloadForm.elements.namedItem("downloadKind"));
  radios.value = kind;
  dom.downloadVideoLabel.textContent = `up to ${maxHeight}p`; // the Video tile's detail
  dom.downloadFolder.textContent = folder ?? defaultPaths["downloads.folder"] ?? "your Downloads folder";
  resetSearch();
  dom.downloadDialog.showModal();
  dom.downloadUrl.focus();
  dom.downloadUrl.select();
}

export function bindDownloads() {
  if (!downloads) return; // not in Electron: no download buttons
  dom.welcomeDownload.hidden = false;
  dom.downloadButton.hidden = false;
  onClick(dom.welcomeDownload, () => openDownloadDialog());
  onClick(dom.downloadButton, () => openDownloadDialog());
  onClick(dom.downloadClose, () => dom.downloadDialog.close());
  // A click on the backdrop (outside the dialog's box) closes it, as in Settings.
  dom.downloadDialog.addEventListener(
    "click",
    (event) => event.target === dom.downloadDialog && dom.downloadDialog.close(),
  );

  // Chapters or not: remembered for next time (Settings › Downloads).
  dom.downloadChapters.addEventListener(
    "change",
    guarded(() => setPref("downloads", "chapters", dom.downloadChapters.checked)),
  );
  const chosenKind = () => (new FormData(dom.downloadForm).get("downloadKind") === "video" ? "video" : "audio");
  // A link downloads; words search, and the dialog stays open for the results.
  dom.downloadForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = dom.downloadUrl.value.trim();
    if (!looksLikeLink(text)) return guarded(searchFor)(text);
    dom.downloadDialog.close();
    guarded(downloadLink)(text, chosenKind());
  });
  bindSearch((result) => {
    const kind = chosenKind();
    dom.downloadDialog.close();
    guarded(downloadLink)(result.url, kind);
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
