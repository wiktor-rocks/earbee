// File names and types, and what a media file is.

/**
 * Something to open: a File the user chose or dropped, or a file the main
 * process serves by URL (a download; see electron/media-files.js). Either
 * way it's read in pieces, never whole.
 * @typedef {File | { name: string, url: string }} Media
 */

export const fileExtension = (name) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();

// `videoExtensions` is CONFIG.video.extensions.
/** @param {Media} media @param {string[]} videoExtensions */
export const isVideoFile = (media, videoExtensions) =>
  ("type" in media && media.type.startsWith("video/")) || videoExtensions.includes(fileExtension(media.name));

/**
 * A Mediabunny source reading `media`. The classes are passed in (core
 * imports nothing).
 * @param {Media} media
 * @param {{ BlobSource: any, UrlSource: any }} sources
 */
export const mediaSource = (media, { BlobSource, UrlSource }) =>
  media instanceof Blob ? new BlobSource(media) : new UrlSource(media.url);

/**
 * All of `media`'s bytes at once (only for the decoding fallback, on files
 * Mediabunny can't read).
 * @param {Media} media
 */
export const readWhole = async (media) =>
  media instanceof Blob ? media.arrayBuffer() : (await fetch(media.url)).arrayBuffer();
