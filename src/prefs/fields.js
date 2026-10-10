// Preferences ("Settings" in the UI): how a section of settings is
// declared, and the pure logic around it: defaults, checking stored or sent
// values, setting one value. No DOM and no Node, so the page (the Settings
// dialog, ui/prefs.js) and the main process (electron/prefs-store.js, which
// keeps prefs.json) share it.
//
// A section is one file in sections/, listed in SECTIONS (index.js):
//
//   defineSection({
//     id: "downloads",            // its key in prefs.json
//     title: "Downloads",         // its heading in the dialog
//     icon: "download",           // its tab's icon: an #i-… sprite id (optional)
//     electronOnly: true,         // hidden outside Electron (optional)
//     fields: [ { key, type, label, help?, default, …type's own } ],
//     onSet(values, key) { … },   // keeps related fields consistent (optional)
//   })
//
// Field types (TYPES below; a new type is one entry there and a renderer in
// ui/pref-fields.js):
//   choice   one of `options` [{ value, label, detail?, swatch? }]
//   boolean  true or false
//   number   `min` … `max`, rounded to `step`; `unit` is shown after it
//   folder   an absolute path, or null for the default. Only the main
//            process sets one (its folder picker): the page can't send a
//            path (`fromPage: false`).
// Any field may have visibleWhen(values): shown only when it returns true.

/**
 * @typedef {object} Option
 * @property {string | number} value
 * @property {string} label
 * @property {string} [detail]
 * @property {string[]} [swatch] Colours to preview the option with.
 *
 * @typedef {object} Field
 * @property {string} key
 * @property {"choice" | "boolean" | "number" | "folder"} type
 * @property {string} label
 * @property {string} [help]
 * @property {any} default
 * @property {Option[]} [options] choice
 * @property {number} [min] number
 * @property {number} [max] number
 * @property {number} [step] number
 * @property {string} [unit] number: shown after the value, e.g. "%"
 * @property {(values: Record<string, any>) => boolean} [visibleWhen]
 *
 * @typedef {object} Section
 * @property {string} id
 * @property {string} title
 * @property {string} [icon] Its tab's icon, an #i-… id in index.html's sprite.
 * @property {boolean} [electronOnly]
 * @property {Field[]} fields
 * @property {(values: Record<string, any>, key: string) => void} [onSet]
 *   Called after `key` changed, on a copy of the values it may change.
 */

const INVALID = Symbol("invalid");

// Each type's check: the value, cleaned up, or INVALID.
/** @type {Record<string, { normalize: (value: any, field: Field) => any, fromPage?: boolean }>} */
export const TYPES = {
  choice: {
    normalize: (value, field) => (field.options.some((option) => option.value === value) ? value : INVALID),
  },
  boolean: {
    normalize: (value) => (typeof value === "boolean" ? value : INVALID),
  },
  number: {
    normalize(value, { min = -Infinity, max = Infinity, step }) {
      if (typeof value !== "number" || !Number.isFinite(value)) return INVALID;
      const stepped = step ? Math.round(value / step) * step : value;
      return Math.min(max, Math.max(min, stepped));
    },
  },
  folder: {
    normalize: (value) => (value === null || isAbsolutePath(value) ? value : INVALID),
    fromPage: false,
  },
};

// POSIX (/home/…), Windows (C:\…) or UNC (\\server\…), of a sane length.
function isAbsolutePath(value) {
  return (
    typeof value === "string" && value.length < 4096 && !value.includes("\0") && /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(value)
  );
}

export class PrefsError extends Error {}

/**
 * Checks a section's declaration once, when it's defined, so a mistake in
 * one fails at startup (and in the unit tests) instead of misbehaving.
 * @param {Section} section
 * @returns {Section}
 */
export function defineSection(section) {
  if (!/^[a-z][a-zA-Z]*$/.test(section.id)) throw new PrefsError(`Bad section id: ${section.id}`);
  const keys = new Set();
  for (const field of section.fields) {
    const where = `${section.id}.${field.key}`;
    if (keys.has(field.key)) throw new PrefsError(`Duplicate field: ${where}`);
    keys.add(field.key);
    const type = TYPES[field.type];
    if (!type) throw new PrefsError(`Unknown field type for ${where}: ${field.type}`);
    if (type.normalize(field.default, field) !== field.default) throw new PrefsError(`Bad default for ${where}`);
  }
  return section;
}

/** @param {Section} section */
export const defaultsOf = (section) => Object.fromEntries(section.fields.map((field) => [field.key, field.default]));

/**
 * A complete, valid set of values for `section`: what `stored` has that is
 * valid, the defaults for the rest. Unknown keys are dropped.
 * @param {Section} section
 * @param {unknown} stored
 */
export function normalizeSection(section, stored) {
  const source = stored && typeof stored === "object" ? /** @type {Record<string, any>} */ (stored) : {};
  return Object.fromEntries(
    section.fields.map((field) => {
      const value = Object.hasOwn(source, field.key) ? TYPES[field.type].normalize(source[field.key], field) : INVALID;
      return [field.key, value === INVALID ? field.default : value];
    }),
  );
}

/**
 * Every section's values, from what was stored (prefs.json, localStorage).
 * @param {Section[]} sections
 * @param {unknown} stored
 * @returns {Record<string, Record<string, any>>}
 */
export function normalizeAll(sections, stored) {
  const source = stored && typeof stored === "object" ? /** @type {Record<string, any>} */ (stored) : {};
  return Object.fromEntries(sections.map((section) => [section.id, normalizeSection(section, source[section.id])]));
}

/**
 * `values` with `key` set to `value`, after the section's onSet. Throws a
 * PrefsError for an unknown key or a value its type refuses; `fromPage`
 * also refuses what only the main process may set (a folder path).
 * @param {Section} section
 * @param {Record<string, any>} values
 * @param {string} key
 * @param {unknown} value
 * @param {{ fromPage?: boolean }} [options]
 */
export function setValue(section, values, key, value, { fromPage = false } = {}) {
  const field = section.fields.find((candidate) => candidate.key === key);
  if (!field) throw new PrefsError(`Unknown setting: ${section.id}.${key}`);
  const type = TYPES[field.type];
  if (fromPage && type.fromPage === false && value !== field.default) {
    throw new PrefsError(`${section.id}.${key} can't be set from the page`);
  }
  const clean = type.normalize(value, field);
  if (clean === INVALID) throw new PrefsError(`Invalid value for ${section.id}.${key}`);
  const next = { ...values, [key]: clean };
  section.onSet?.(next, key);
  return normalizeSection(section, next);
}

/** `values` with `key` (or every field, without one) back to its default. */
export function resetValue(section, values, key) {
  if (key === undefined) return defaultsOf(section);
  const field = section.fields.find((candidate) => candidate.key === key);
  if (!field) throw new PrefsError(`Unknown setting: ${section.id}.${key}`);
  return setValue(section, values, key, field.default);
}

/** Whether `field` is shown, given its section's current values. */
export const isVisible = (field, values) => !field.visibleWhen || field.visibleWhen(values);
