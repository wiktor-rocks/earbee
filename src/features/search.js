// Searching by keywords, in the download dialog (features/download.js):
// when the box holds words rather than a link, Search lists results from
// the chosen site, PAGE_SIZE at a time (Show more for the next), each with
// its picture, title, channel, length and views. Picking one downloads it;
// the arrow button opens its page in the browser. The search runs in the
// main process (electron/downloader.js, with yt-dlp), which also fetches
// the pictures and hands them over as data: URLs: the page never touches
// the network. The sites are src/search/sources.js.
import { formatCount, formatDuration } from "../core/format.js";
import { SEARCH_SOURCES, isLinkOn, sourceById } from "../search/sources.js";
import { dom, element, guarded, onClick } from "../ui/dom.js";
import { getPrefs, setPref } from "../ui/prefs.js";

/**
 * @typedef {import("../search/sources.js").SearchResult} SearchResult
 * @typedef {{ ok: true, searchId: number, results: SearchResult[], more: boolean }
 *   | { ok: false, canceled: boolean, error: string }} SearchAnswer
 *
 * The part of window.transcribee (electron/preload.js) used here.
 * @typedef {object} SearchBridge
 * @property {(text: string, source: string, page: number) => Promise<SearchAnswer>} search
 * @property {() => Promise<void>} cancelSearch
 * @property {(callback: (thumbnail: { searchId: number, index: number, src: string }) => void) => () => void} onThumbnail
 * @property {(callback: (progress: { stage: string, fraction?: number | null }) => void) => () => void} onDownloadProgress
 * @property {(url: string) => Promise<boolean>} openExternal
 */
const bridge = /** @type {SearchBridge | undefined} */ (/** @type {any} */ (window).transcribee);

export const looksLikeLink = (text) => /^https?:\/\/\S+$/i.test(text.trim());

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
  onClick(open, () => bridge?.openExternal(result.url));

  return { row: element("li", {}, choose, open), picture };
}

/* ---------- Searching ---------- */

/**
 * Searches for `text` (page 1: a new list) or shows the next page.
 * @param {string} text
 * @param {number} [page]
 */
export async function searchFor(text, page = 1) {
  if (!bridge) return;
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
  const stopListening = bridge.onDownloadProgress(({ stage, fraction }) => {
    if (mine !== latest) return;
    const percent = fraction == null ? "" : ` ${Math.floor(fraction * 100)} %`;
    if (stage === "setup") showStatus(`Setting up the downloader (first time only)…${percent}`);
    else if (stage === "update") showStatus("Updating the downloader…");
  });
  let answer;
  try {
    answer = await bridge.search(text, source.id, page);
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
export function cancelSearch() {
  latest++;
  bridge?.cancelSearch();
}

/* ---------- The dialog ---------- */

// Download for a link, Search for words (and then where to search).
export function updateSearchMode() {
  const isLink = looksLikeLink(dom.downloadUrl.value) || !bridge;
  dom.downloadSubmit.textContent = isLink ? "Download" : "Search";
  dom.searchSource.hidden = isLink;
}

// The dialog opens empty, on the site last searched.
export function resetSearch() {
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
export function bindSearch(onPick) {
  pick = onPick;
  dom.searchSource.replaceChildren(
    ...SEARCH_SOURCES.map((source) => element("option", { value: source.id }, source.name)),
  );
  if (!bridge) return;
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
