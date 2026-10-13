// Downloading a link (YouTube): the From YouTube dialog (index.html; it
// looks like Settings), pasting a link, and progress on the loading
// screen. Words instead of a link search (below), and the result picked
// downloads like a link. The download itself runs in the main process
// (electron/downloader.js), reached through window.scribee
// (electron/preload.js); the file then opens like any other.
import { AppError } from "../core/errors.js";
import { formatCount, formatDuration, formatEta } from "../core/format.js";
import { SEARCH_SOURCES, isLinkOn, sourceById } from "../search/sources.js";
import { dom, element, guarded, onClick, setLoadingStatus, showNotice } from "../ui/dom.js";
import { defaultPaths, getPrefs, setPref } from "../ui/prefs.js";
import { isTextField } from "../ui/shortcuts.js";
import { notify } from "../ui/toast.js";
import { isLoading, withLoading } from "./open-file.js";
import { confirmUnsaved, loadMedia } from "./project/index.js";

/**
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
 * @typedef {import("../search/sources.js").SearchResult} SearchResult
 * @typedef {{ ok: true, searchId: number, results: SearchResult[], more: boolean }
 *   | { ok: false, canceled: boolean, error: string }} SearchAnswer
 *
 * The part of window.scribee (electron/preload.js) used here; missing
 * outside Electron, and then there's no downloading or searching at all.
 * @typedef {object} DownloadBridge
 * @property {(url: string, kind: string) => Promise<DownloadResult>} download
 * @property {() => Promise<void>} cancelDownload
 * @property {(callback: (progress: DownloadProgress) => void) => () => void} onDownloadProgress
 * @property {(text: string, source: string, page: number) => Promise<SearchAnswer>} search
 * @property {() => Promise<void>} cancelSearch
 * @property {(callback: (thumbnail: { searchId: number, index: number, src: string }) => void) => () => void} onThumbnail
 * @property {(url: string) => Promise<boolean>} openExternal
 */
const bridge = /** @type {DownloadBridge | undefined} */ (/** @type {any} */ (window).scribee);

/**
 * What a download (or, setting up yt-dlp, a search) is doing, in words.
 * @param {DownloadProgress} progress
 * @param {string} [kind] "audio" or "video"
 */
function describeDownload({ stage, part = 1, parts = 1, fraction, eta }, kind = "audio") {
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
  if (!bridge || !(await confirmUnsaved())) return;
  const withChapters = dom.downloadChapters.checked; // as the dialog was left
  return withLoading(url, async (signal) => {
    setLoadingStatus(describeDownload({ stage: "download", fraction: 0 }, kind), true);
    const cancel = () => bridge.cancelDownload();
    signal.addEventListener("abort", cancel);
    const stopListening = bridge.onDownloadProgress((progress) => {
      setLoadingStatus(describeDownload(progress, kind), progress.stage !== "join");
      if (progress.title) dom.loadingFileName.textContent = dom.overlayTitle.textContent = progress.title;
    });
    let result;
    try {
      result = await bridge.download(url, kind);
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
    showNotice(notices.join(" "));
    notify(`Downloaded “${result.name}”`, result.path);
  });
}

// Starts on the kind set in Settings › Downloads, and says where the file
// will go and the best video quality, from there too.
function openDownloadDialog(url = "") {
  // Not over another dialog (Settings) or while something loads.
  if (!bridge || isLoading() || document.querySelector("dialog[open]")) return;
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
  if (!bridge) return; // not in Electron: no download buttons
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

/* ---------- Searching ---------- */

// Searching by keywords, in the download dialog:
// when the box holds words rather than a link, Search lists results from
// the chosen site, PAGE_SIZE at a time (Show more for the next), each with
// its picture, title, channel, length and views. Picking one downloads it;
// the arrow button opens its page in the browser. The search runs in the
// main process (electron/downloader.js, with yt-dlp), which also fetches
// the pictures and hands them over as data: URLs: the page never touches
// the network. The sites are src/search/sources.js.

const looksLikeLink = (text) => /^https?:\/\/\S+$/i.test(text.trim());

// The search on screen: its words, site and last page; and, by the
// main process's searchId, the pictures still to come for each page.
let current = { text: "", source: "", page: 0 };
let latest = 0; // counts searches, so an old answer is ignored
/** @type {Map<number, HTMLImageElement[]>} */
const pictures = new Map();
/** @type {Map<number, { index: number, src: string }[]>} pictures that came before their page */
const early = new Map();
/** @type {(result: SearchResult) => void} */
let pick = () => {};

/* ---------- Showing ---------- */

/** @param {string} text @param {"" | "error"} [kind] */
function showStatus(text, kind = "") {
  dom.searchStatus.hidden = !text;
  dom.searchStatus.textContent = text;
  dom.searchStatus.classList.toggle("error", kind === "error");
}

// "Queen Official · 5:55 · 2.1B views", leaving out what isn't known.
const describe = (result) =>
  [
    result.channel,
    result.duration === null ? "" : formatDuration(result.duration),
    result.views === null ? "" : `${formatCount(result.views)} views`,
  ]
    .filter(Boolean)
    .join(" · ");

/** @param {SearchResult} result */
function buildRow(result) {
  const picture = /** @type {HTMLImageElement} */ (element("img", { className: "search-thumb", alt: "" }));
  picture.addEventListener("load", () => picture.classList.add("loaded"));
  const choose = element(
    "button",
    { type: "button", className: "search-result" },
    picture,
    element(
      "span",
      { className: "search-text" },
      element("span", { className: "search-title" }, result.title),
      element("span", { className: "search-meta" }, describe(result)),
    ),
  );
  choose.title = `Download “${result.title}”`;
  onClick(choose, () => pick(result));

  const source = SEARCH_SOURCES.find((each) => isLinkOn(result.url, each.hosts))?.name ?? "the browser";
  const open = element("button", { type: "button", className: "search-open" });
  open.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-external" /></svg>`;
  open.title = `Open on ${source}`;
  open.setAttribute("aria-label", open.title);
  onClick(open, () => bridge.openExternal(result.url));

  return { row: element("li", {}, choose, open), picture };
}

/* ---------- Running a search ---------- */

/**
 * Searches for `text` (page 1: a new list) or shows the next page.
 * @param {string} text
 * @param {number} [page]
 */
async function searchFor(text, page = 1) {
  const source = sourceById(dom.searchSource.value) ?? SEARCH_SOURCES[0];
  const mine = ++latest;
  current = { text, source: source.id, page };
  if (page === 1) {
    dom.searchResults.replaceChildren();
    dom.searchResults.hidden = true;
    pictures.clear();
    early.clear();
  }
  dom.searchMore.hidden = true;
  showStatus(`Searching ${source.name}…`);

  // The first search also sets up the downloader, which can take a while.
  const stopListening = bridge.onDownloadProgress((progress) => {
    if (mine !== latest || !["setup", "update"].includes(progress.stage)) return;
    showStatus(describeDownload(progress));
  });
  let answer;
  try {
    answer = await bridge.search(text, source.id, page);
  } catch (error) {
    // The bridge itself failed (it answers failures as { ok: false }).
    console.warn("Search failed:", error);
    answer = { ok: false, error: "The search failed. Try again." };
  } finally {
    stopListening();
  }
  if (mine !== latest) return; // a newer search, or the dialog closed
  if (!answer.ok) {
    showStatus(answer.canceled ? "" : answer.error, "error");
    if (page > 1) dom.searchMore.hidden = false; // try again
    return;
  }

  const built = answer.results.map(buildRow);
  dom.searchResults.append(...built.map((each) => each.row));
  dom.searchResults.hidden = dom.searchResults.children.length === 0;
  pictures.set(
    answer.searchId,
    built.map((each) => each.picture),
  );
  for (const { index, src } of early.get(answer.searchId) ?? []) showPicture(answer.searchId, index, src);
  early.delete(answer.searchId);

  dom.searchMore.hidden = !answer.more;
  if (dom.searchResults.children.length === 0) showStatus(`No results for “${text}” on ${source.name}.`);
  else showStatus("");
  if (page === 1) /** @type {HTMLElement | null} */ (dom.searchResults.querySelector(".search-result"))?.focus();
}

function showPicture(searchId, index, src) {
  const picture = pictures.get(searchId)?.[index];
  if (picture) picture.src = src;
  else if (!pictures.has(searchId)) early.set(searchId, [...(early.get(searchId) ?? []), { index, src }]);
}

/** Stops a search still running and forgets its answer. */
function cancelSearch() {
  latest++;
  bridge.cancelSearch();
}

/* ---------- The dialog ---------- */

// Download for a link, Search for words (and then where to search).
function updateSearchMode() {
  const isLink = looksLikeLink(dom.downloadUrl.value);
  dom.downloadSubmit.textContent = isLink ? "Download" : "Search";
  dom.searchSource.hidden = isLink;
}

// The dialog opens empty, on the site last searched.
function resetSearch() {
  cancelSearch();
  current = { text: "", source: "", page: 0 };
  dom.searchResults.replaceChildren();
  dom.searchResults.hidden = true;
  dom.searchMore.hidden = true;
  showStatus("");
  dom.searchSource.value = getPrefs("downloads")?.searchSource ?? SEARCH_SOURCES[0].id;
  updateSearchMode();
}

/**
 * @param {(result: SearchResult) => void} onPick A result was chosen (download it).
 */
function bindSearch(onPick) {
  pick = onPick;
  dom.searchSource.replaceChildren(
    ...SEARCH_SOURCES.map((source) => element("option", { value: source.id }, source.name)),
  );
  dom.downloadUrl.addEventListener("input", updateSearchMode);
  bridge.onThumbnail(({ searchId, index, src }) => showPicture(searchId, index, src));
  onClick(dom.searchMore, () => searchFor(current.text, current.page + 1));
  // Another site: remembered, and the same words searched there.
  dom.searchSource.addEventListener(
    "change",
    guarded(async () => {
      const text = dom.downloadUrl.value.trim();
      if (text && !looksLikeLink(text) && current.text) searchFor(text);
      await setPref("downloads", "searchSource", dom.searchSource.value);
    }),
  );
  dom.downloadDialog.addEventListener("close", cancelSearch);
}
