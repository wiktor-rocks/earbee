// Downloading a link (YouTube): the dialog, pasting a link, and progress on
// the loading screen. The download itself runs in the main process
// (electron/downloader.js), reached through window.transcribee
// (electron/preload.js); the file then opens like any other.
import { AppError } from "../core/errors.js";
import { formatEta } from "../core/format.js";
import { dom, guarded, onClick, setLoadingStatus, showNotice } from "../ui/dom.js";
import { isTextField } from "../ui/shortcuts.js";
import { isLoading, loadMediaFile, withLoading } from "./open-file.js";

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

export function openDownloadDialog(url = "") {
  if (!downloads || isLoading() || dom.downloadDialog.open) return;
  dom.downloadUrl.value = url;
  const kind = /** @type {HTMLInputElement} */ (dom.downloadForm.elements.namedItem("downloadKind"));
  /** @type {RadioNodeList} */ (/** @type {unknown} */ (kind)).value = downloadKind;
  dom.downloadDialog.showModal();
  dom.downloadUrl.focus();
  dom.downloadUrl.select();
}

const looksLikeLink = (text) => /^https?:\/\/\S+$/i.test(text.trim());

export function bindDownloads() {
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
