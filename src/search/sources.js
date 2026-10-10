// Where the download dialog can search by keywords, and what a result is.
// Pure (no DOM), so the main process uses it too: electron/downloader.js
// builds the search from it and checks what comes back, and the page lists
// the sources. The searching itself is yt-dlp's (a "flat" search: one line
// of JSON per result, without opening each one).
//
// A new site: add a source. `query(text, count)` is what yt-dlp is asked
// for (its search prefixes: ytsearch, scsearch, …); `hosts` are where its
// results may link to (anything else is dropped, and Open in browser only
// opens these). Check what its flat results hold first: YouTube Music's,
// for example, have only a title (no artist, length or picture), so it
// isn't offered.

/**
 * @typedef {object} SearchSource
 * @property {string} id Saved in Settings; never change it.
 * @property {string} name
 * @property {(text: string, count: number) => string} query
 * @property {string[]} hosts
 * @property {(id: string) => string | null} [thumbnailFor] A picture when the result has none.
 */

/** @type {SearchSource[]} */
export const SEARCH_SOURCES = [
  {
    id: "youtube",
    name: "YouTube",
    query: (text, count) => `ytsearch${count}:${text}`,
    hosts: ["youtube.com", "youtu.be"],
    // Every YouTube video has these, whatever the search returned.
    thumbnailFor: (id) => (/^[\w-]{11}$/.test(id) ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null),
  },
  {
    id: "soundcloud",
    name: "SoundCloud",
    query: (text, count) => `scsearch${count}:${text}`,
    hosts: ["soundcloud.com"],
  },
];

export const DEFAULT_SOURCE = "youtube";
// Results per search, and per Show more.
export const PAGE_SIZE = 8;
export const MAX_QUERY_LENGTH = 200;
// Thumbnails: the smallest at least this wide (they're shown 96 px wide, at up to 2×).
const THUMBNAIL_WIDTH = 160;

/** @param {string} id */
export const sourceById = (id) => SEARCH_SOURCES.find((source) => source.id === id) ?? null;

/**
 * Keywords as they're searched for: one line, no control characters, at
 * most MAX_QUERY_LENGTH long; "" if nothing's left.
 * @param {unknown} text
 */
export const cleanQuery = (text) =>
  String(text ?? "")
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .trim();

/**
 * Whether `url` is an https link on one of `hosts` (or a subdomain: www., m., …).
 * @param {unknown} url
 * @param {string[]} hosts
 */
export function isLinkOn(url, hosts) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return parsed.protocol === "https:" && hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** Whether `url` may be opened in the browser: a result's link on any source. @param {unknown} url */
export const isResultLink = (url) => SEARCH_SOURCES.some((source) => isLinkOn(url, source.hosts));

// The smallest https picture at least THUMBNAIL_WIDTH wide, else the widest.
function pickThumbnail(thumbnails) {
  const usable = (Array.isArray(thumbnails) ? thumbnails : []).filter(
    (thumbnail) => typeof thumbnail?.url === "string" && thumbnail.url.startsWith("https://"),
  );
  const width = (thumbnail) => (Number.isFinite(thumbnail.width) ? thumbnail.width : 0);
  const wide = usable.filter((thumbnail) => width(thumbnail) >= THUMBNAIL_WIDTH);
  if (wide.length) return wide.reduce((best, each) => (width(each) < width(best) ? each : best)).url;
  return usable.reduce((best, each) => (width(each) >= width(best ?? each) ? each : best), null)?.url ?? null;
}

/**
 * @typedef {object} SearchResult
 * @property {string} id
 * @property {string} title
 * @property {string} channel "" if unknown
 * @property {number | null} duration Seconds.
 * @property {number | null} views
 * @property {string} url The page to download (and open in the browser).
 * @property {string | null} thumbnail
 */

/**
 * A result from one of yt-dlp's flat search entries, or null if it isn't
 * one (no title, or a link off the source's sites).
 * @param {any} entry
 * @param {SearchSource} source
 * @returns {SearchResult | null}
 */
export function normalizeResult(entry, source) {
  if (!entry || typeof entry !== "object" || typeof entry.title !== "string" || !entry.title.trim()) return null;
  // SoundCloud's `url` is its API; the page people see is `webpage_url`.
  const url = [entry.webpage_url, entry.url].find((candidate) => isLinkOn(candidate, source.hosts));
  if (!url) return null;
  const id = typeof entry.id === "string" ? entry.id : String(entry.id ?? "");
  const positive = (value) => (Number.isFinite(value) && value > 0 ? value : null);
  const name = [entry.channel, entry.uploader, entry.artist].find((each) => typeof each === "string" && each.trim());
  return {
    id,
    title: entry.title.trim(),
    channel: name?.trim() ?? "",
    duration: positive(entry.duration),
    views: Number.isFinite(entry.view_count) && entry.view_count >= 0 ? entry.view_count : null,
    url,
    thumbnail: pickThumbnail(entry.thumbnails) ?? source.thumbnailFor?.(id) ?? null,
  };
}
