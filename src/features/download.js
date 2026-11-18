// Downloading a link (YouTube): the From YouTube dialog (index.html; it
// looks like Settings), pasting a link, and progress on the loading
// screen. Words instead of a link search (below), and the result picked
// downloads like a link. The download itself runs in the main process
// (electron/downloader.js), reached through window.earbee
// (electron/preload.js); the file then opens like any other.
import { CONFIG } from "../config.js";
import { AppError } from "../core/errors.js";
import { formatCount, formatDuration, formatEta } from "../core/format.js";
import { addSearch, parseHistory, removeSearch } from "../core/search-history.js";
import { VIDEO_HEIGHTS } from "../prefs/index.js";
import { SEARCH_SOURCES, isLinkOn, sourceById } from "../search/sources.js";
import { dom, element, guarded, onClick, setLoadingStatus, showNotice } from "../ui/dom.js";
import { defaultPaths, getPrefs, setPref } from "../ui/prefs.js";
import { isTextField } from "../ui/shortcuts.js";
import { readStored, store } from "../ui/storage.js";
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
 * The part of window.earbee (electron/preload.js) used here; missing
 * outside Electron, and then there's no downloading or searching at all.
 * @typedef {object} DownloadBridge
 * @property {(url: string, kind: string, maxHeight: number) => Promise<DownloadResult>} download
 * @property {() => Promise<void>} cancelDownload
 * @property {(callback: (progress: DownloadProgress) => void) => () => void} onDownloadProgress
 * @property {(text: string, source: string, page: number) => Promise<SearchAnswer>} search
 * @property {() => Promise<void>} cancelSearch
 * @property {(callback: (thumbnail: { searchId: number, index: number, src: string }) => void) => () => void} onThumbnail
 * @property {(url: string) => Promise<boolean>} openExternal
 */
const bridge = /** @type {DownloadBridge | undefined} */ (/** @type {any} */ (window).earbee);

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
async function downloadLink(url, kind, maxHeight) {
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
      result = await bridge.download(url, kind, maxHeight);
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

// The quality only matters for a video: off for audio, and the Video
// tile says it ("up to 1080p").
function showQuality() {
  dom.downloadVideoLabel.textContent = `up to ${dom.downloadQuality.value}p`;
  dom.downloadQuality.disabled = new FormData(dom.downloadForm).get("downloadKind") !== "video";
}

// Starts on the kind and the best video quality set in Settings ›
// Downloads, and says where the file will go, from there too.
function openDownloadDialog(url = "") {
  // Not over another dialog (Settings) or while something loads.
  if (!bridge || isLoading() || document.querySelector("dialog[open]")) return;
  const { kind, folder, maxHeight, chapters } = getPrefs("downloads");
  dom.downloadChapters.checked = chapters;
  dom.downloadUrl.value = url;
  const radios = /** @type {RadioNodeList} */ (dom.downloadForm.elements.namedItem("downloadKind"));
  radios.value = kind;
  dom.downloadQuality.value = String(maxHeight); // for this download only
  showQuality();
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
  const chosenHeight = () => Number(dom.downloadQuality.value);
  // The quality: the heights Settings offers; chosen here, it's for this
  // download only (the setting is where the dialog starts).
  dom.downloadQuality.replaceChildren(
    ...VIDEO_HEIGHTS.map((height) => element("option", { value: String(height) }, `${height}p`)),
  );
  dom.downloadQuality.addEventListener("change", showQuality);
  dom.downloadForm.addEventListener("change", (event) => {
    if (/** @type {HTMLInputElement} */ (event.target).name === "downloadKind") showQuality();
  });
  // A link downloads; words search, and the dialog stays open for the results.
  dom.downloadForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = dom.downloadUrl.value.trim();
    if (!looksLikeLink(text)) return guarded(searchFor)(text);
    dom.downloadDialog.close();
    guarded(downloadLink)(text, chosenKind(), chosenHeight());
  });
  bindSearch((result) => {
    const kind = chosenKind();
    const height = chosenHeight();
    dom.downloadDialog.close();
    guarded(downloadLink)(result.url, kind, height);
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
//
// While the box is empty, the searches made lately show instead of the
// results (Search history, below): one click searches again, on its site.

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

  if (page === 1) rememberSearch(text, source.id);
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

/* ---------- Search history ---------- */

// The words searched and where, newest first, kept between runs in the
// browser's storage (CONFIG.search.historyMax of them; core/search-history.js
// says what counts as the same search). A search is kept once it has
// answered, even with no results; a failed or canceled one isn't.

const HISTORY_KEY = "earbee.searchHistory";
/** @type {import("../core/search-history.js").PastSearch[] | null} */
let history = null;

const pastSearches = () =>
  (history ??= parseHistory(
    readStored(HISTORY_KEY),
    CONFIG.search.historyMax,
    SEARCH_SOURCES.map((source) => source.id),
  ));

/** @param {import("../core/search-history.js").PastSearch[]} next */
function saveHistory(next) {
  history = next;
  store(HISTORY_KEY, JSON.stringify(next));
  renderHistory();
  updateSearchMode();
}

/** @param {string} text @param {string} source */
const rememberSearch = (text, source) =>
  saveHistory(addSearch(pastSearches(), { text, source, time: Date.now() }, CONFIG.search.historyMax));

const historyButtons = () =>
  /** @type {HTMLButtonElement[]} */ ([...dom.searchHistoryList.querySelectorAll(".search-history-item")]);

function renderHistory() {
  const rows = pastSearches().map((search, index) => {
    const source = sourceById(search.source);
    const again = element(
      "button",
      { type: "button", className: "search-history-item" },
      element("span", { className: "search-history-text" }, search.text),
      element("span", { className: "search-history-source" }, source?.name ?? search.source),
    );
    again.insertAdjacentHTML("afterbegin", `<svg class="icon" aria-hidden="true"><use href="#i-search" /></svg>`);
    again.title = `Search ${source?.name ?? ""} for “${search.text}” again`;
    onClick(again, () => searchAgain(search));
    const remove = element("button", { type: "button", className: "search-history-remove" });
    remove.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-close" /></svg>`;
    remove.title = "Remove from history";
    remove.setAttribute("aria-label", `Remove “${search.text}” from history`);
    onClick(remove, () => {
      const at = historyButtons().indexOf(/** @type {any} */ (document.activeElement));
      saveHistory(removeSearch(pastSearches(), index));
      // Focus stays in the list (or goes back to the box when it's empty).
      const left = historyButtons();
      (left[Math.min(Math.max(at, index), left.length - 1)] ?? dom.downloadUrl).focus();
    });
    return element("li", {}, again, remove);
  });
  dom.searchHistoryList.replaceChildren(...rows);
}

// A past search: its words in the box, its site picked (and remembered,
// as the picker does), and searched.
/** @param {import("../core/search-history.js").PastSearch} search */
async function searchAgain(search) {
  dom.downloadUrl.value = search.text;
  dom.searchSource.value = search.source;
  updateSearchMode();
  dom.downloadUrl.focus();
  await Promise.all([searchFor(search.text), setPref("downloads", "searchSource", search.source)]);
}

// ↓ from the empty box to the first past search; ↑ / ↓ between them, and
// ↑ from the first back to the box.
/** @param {KeyboardEvent} event */
function moveInHistory(event) {
  if (dom.searchHistory.hidden || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
  const buttons = historyButtons();
  const target = /** @type {HTMLElement} */ (event.target);
  const at = buttons.indexOf(/** @type {HTMLButtonElement} */ (target));
  let next;
  if (target === dom.downloadUrl) next = event.key === "ArrowDown" ? buttons[0] : null;
  else if (at !== -1) next = event.key === "ArrowDown" ? buttons[at + 1] : (buttons[at - 1] ?? dom.downloadUrl);
  if (!next) return;
  event.preventDefault();
  next.focus();
}

/* ---------- The dialog ---------- */

// Download for a link, Search for words (and then where to search); the
// search history while the box is empty (the results stay, hidden, until
// something is typed again).
function updateSearchMode() {
  const isLink = looksLikeLink(dom.downloadUrl.value);
  dom.downloadSubmit.textContent = isLink ? "Download" : "Search";
  dom.searchSource.hidden = isLink;
  dom.searchHistory.hidden = dom.downloadUrl.value.trim() !== "" || pastSearches().length === 0;
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
  renderHistory();
  onClick(dom.searchHistoryClear, () => {
    saveHistory([]);
    dom.downloadUrl.focus();
  });
  dom.downloadUrl.addEventListener("keydown", moveInHistory);
  dom.searchHistoryList.addEventListener("keydown", moveInHistory);
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
