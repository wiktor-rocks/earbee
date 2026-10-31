// What a EarBee project file (.ebee) is. Pure (no DOM), so the main
// process uses it too (electron/project-files.js) to read and write them.
//
// A .ebee file is a UTF-8 JSON header, optionally followed by one NUL byte
// and its payload: the media's own bytes (a project "with the media
// inside"), then its blobs. Without either it is plain JSON, readable and
// editable; JSON never contains a raw NUL, so the header ends at the first
// one.
//
//   {
//     "format": "earbee-project",
//     "version": 1,                     (2 with blobs)
//     "savedWith": "1.0.0",
//     "media": { "name", "path", "relativePath", "size", "duration", "embedded" },
//     "sections": { "<id>": { "version": n, … }, … },
//     "blobs": { "<id>": { "offset", "size" }, … }   (only with blobs)
//   }
//
// Blobs: a section's saved form may hold binary data (Uint8Arrays, such as
// the stems' audio). extractBlobs() takes each out, leaving { "blob": id }
// in its place, and the file stores the bytes after the media; "offset" is
// from the payload's start. Opening, attachBlobs() puts back whatever the
// reader gives for each (the main process: a URL to read it from). A file
// with blobs is version 2, so an EarBee from before them refuses it rather
// than read the blobs as part of the media; and its media's "size" is
// where the media ends.
//
// What is saved is decided by the page's sections (features/project/
// sections.js), each versioned on its own; this file only checks the
// frame around them. A newer `version` is refused rather than misread; it
// changes only when the frame itself does.

const PROJECT_FORMAT = "earbee-project";
// The newest version this reads (and writes, with blobs).
export const PROJECT_VERSION = 2;
export const PROJECT_EXTENSION = "ebee";
// The longest header read; anything longer isn't a project.
export const MAX_HEADER_BYTES = 16 * 1024 * 1024;
// Separates the header from the media's bytes, in a project with the media inside.
export const MEDIA_SEPARATOR = 0;

export class ProjectFormatError extends Error {}

/**
 * The media a project belongs to.
 * @typedef {object} ProjectMedia
 * @property {string} name Its file name, as shown.
 * @property {string | null} path Where it was (absolute), when linked.
 * @property {string | null} relativePath The same, relative to the project's folder.
 * @property {number} size In bytes.
 * @property {number} duration In seconds, as decoded.
 * @property {boolean} embedded Whether its bytes follow the header.
 */

/**
 * @typedef {object} Project
 * @property {ProjectMedia} media
 * @property {Record<string, any>} sections Each section's saved form, by id (checked by the section).
 * @property {Record<string, ProjectBlob>} blobs Where each blob is in the payload, by id.
 *
 * @typedef {{ offset: number, size: number }} ProjectBlob
 */

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const stringOrNull = (value) => (typeof value === "string" && value !== "" ? value : null);
const nonNegative = (value) => (Number.isFinite(value) && value >= 0 ? value : 0);

/**
 * @param {any} raw
 * @returns {ProjectMedia}
 */
function normalizeMedia(raw) {
  if (!isObject(raw) || typeof raw.name !== "string" || raw.name === "")
    throw new ProjectFormatError("This project doesn't say which song or video it belongs to.");
  return {
    name: raw.name,
    path: stringOrNull(raw.path),
    relativePath: stringOrNull(raw.relativePath),
    size: nonNegative(raw.size),
    duration: nonNegative(raw.duration),
    embedded: raw.embedded === true,
  };
}

/**
 * The header of a project file, as text.
 * @param {{ media: ProjectMedia, sections: Record<string, any>, blobs?: Record<string, ProjectBlob> | null,
 *   appVersion?: string }} project
 */
export function serializeProject({ media, sections, blobs = null, appVersion }) {
  const withBlobs = isObject(blobs) && Object.keys(blobs).length > 0;
  return JSON.stringify(
    {
      format: PROJECT_FORMAT,
      version: withBlobs ? 2 : 1,
      ...(appVersion ? { savedWith: appVersion } : {}),
      media: normalizeMedia(media),
      sections: isObject(sections) ? sections : {},
      ...(withBlobs ? { blobs } : {}),
    },
    null,
    2,
  );
}

const isBlobReference = (value) => isObject(value) && typeof value.blob === "string" && Object.keys(value).length === 1;

/**
 * Takes the binary data out of sections' saved forms: each Uint8Array (or
 * other typed array) becomes { blob: id }, its id the path to it
 * ("stems/stems/audio/guitar"). The sections given are left as they are.
 * @param {Record<string, any>} sections
 * @returns {{ sections: Record<string, any>, blobs: { id: string, bytes: Uint8Array }[] }}
 */
export function extractBlobs(sections) {
  const blobs = [];
  const walk = (value, path) => {
    if (ArrayBuffer.isView(value)) {
      const id = path.join("/");
      blobs.push({ id, bytes: new Uint8Array(value.buffer, value.byteOffset, value.byteLength) });
      return { blob: id };
    }
    if (Array.isArray(value)) return value.map((item, i) => walk(item, [...path, String(i)]));
    if (isObject(value))
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, [...path, key])]));
    return value;
  };
  return { sections: walk(isObject(sections) ? sections : {}, []), blobs };
}

/**
 * Puts back what `resolve(id)` gives for each { blob: id } in sections'
 * saved forms (left as it is where it gives null).
 * @param {Record<string, any>} sections
 * @param {(id: string) => any} resolve
 */
export function attachBlobs(sections, resolve) {
  const walk = (value) => {
    if (isBlobReference(value)) return resolve(value.blob) ?? value;
    if (Array.isArray(value)) return value.map(walk);
    if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
    return value;
  };
  return walk(sections);
}

// The blobs' places, each checked: whole numbers from 0.
function normalizeBlobs(raw) {
  if (!isObject(raw)) return {};
  const whole = (value) => Number.isInteger(value) && value >= 0;
  return Object.fromEntries(
    Object.entries(raw).filter(([, place]) => isObject(place) && whole(place.offset) && whole(place.size)),
  );
}

/**
 * The project in a header's text. Sections are left as saved: each is
 * checked by the section that reads it.
 * @param {string} text
 * @returns {Project}
 */
export function parseProject(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProjectFormatError("This isn't a EarBee project, or it is damaged.");
  }
  if (!isObject(data) || data.format !== PROJECT_FORMAT || !Number.isInteger(data.version))
    throw new ProjectFormatError("This isn't a EarBee project.");
  if (data.version > PROJECT_VERSION)
    throw new ProjectFormatError("This project was saved by a newer EarBee; update it to open it.");
  return {
    media: normalizeMedia(data.media),
    sections: isObject(data.sections) ? data.sections : {},
    blobs: normalizeBlobs(data.blobs),
  };
}

/**
 * Where the header ends in the first bytes of a file: the index of the
 * separator, or -1 if there is none (yet).
 * @param {Uint8Array} bytes
 */
export const findHeaderEnd = (bytes) => bytes.indexOf(MEDIA_SEPARATOR);

/** @param {string} name */
export const isProjectName = (name) => name.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`);
