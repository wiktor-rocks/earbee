// What a ScriBee project file (.sbee) is. Pure (no DOM), so the main
// process uses it too (electron/project-files.js) to read and write them.
//
// A .sbee file is a UTF-8 JSON header, optionally followed by one NUL byte
// and the media's own bytes (a project "with the media inside"). Without
// the media it is plain JSON, readable and editable; JSON never contains a
// raw NUL, so the header ends at the first one.
//
//   {
//     "format": "scribee-project",
//     "version": 1,
//     "savedWith": "1.0.0",
//     "media": { "name", "path", "relativePath", "size", "duration", "embedded" },
//     "sections": { "<id>": { "version": n, … }, … }
//   }
//
// What is saved is decided by the page's sections (features/project/
// sections.js), each versioned on its own; this file only checks the
// frame around them. A newer `version` is refused rather than misread; it
// changes only when the frame itself does.

const PROJECT_FORMAT = "scribee-project";
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = "sbee";
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
 * @param {{ media: ProjectMedia, sections: Record<string, any>, appVersion?: string }} project
 */
export function serializeProject({ media, sections, appVersion }) {
  return JSON.stringify(
    {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      ...(appVersion ? { savedWith: appVersion } : {}),
      media: normalizeMedia(media),
      sections: isObject(sections) ? sections : {},
    },
    null,
    2,
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
    throw new ProjectFormatError("This isn't a ScriBee project, or it is damaged.");
  }
  if (!isObject(data) || data.format !== PROJECT_FORMAT || !Number.isInteger(data.version))
    throw new ProjectFormatError("This isn't a ScriBee project.");
  if (data.version > PROJECT_VERSION)
    throw new ProjectFormatError("This project was saved by a newer ScriBee; update it to open it.");
  return { media: normalizeMedia(data.media), sections: isObject(data.sections) ? data.sections : {} };
}

/**
 * Where the header ends in the first bytes of a file: the index of the
 * separator, or -1 if there is none (yet).
 * @param {Uint8Array} bytes
 */
export const findHeaderEnd = (bytes) => bytes.indexOf(MEDIA_SEPARATOR);

/** @param {string} name */
export const isProjectName = (name) => name.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`);
