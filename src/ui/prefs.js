// The settings on the page's side: the values, changing them, and hearing
// about changes. The main process keeps the copy that counts (prefs.json,
// electron/prefs-store.js), reached through window.transcribee.prefs;
// outside Electron the values are kept in localStorage instead.
//
// Every change, from the Settings dialog, the palette menu or another
// window, reaches onPrefsChange() listeners, so whatever shows a setting
// just listens. The sections themselves are declared in src/prefs.
import { getSection, normalizePrefsFile, resetValue, setValue } from "../prefs/index.js";

/**
 * @typedef {{ ok: boolean, values?: Record<string, any>, error?: string, canceled?: boolean }} PrefsAnswer
 *   { ok: true, values } (the section's values after the change), or { ok: false, error }.
 * @typedef {object} PrefsBridge
 * @property {Record<string, Record<string, any>> | null} values
 * @property {Record<string, string>} defaultPaths
 * @property {(section: string, key: string, value: unknown) => Promise<PrefsAnswer>} set
 * @property {(section: string, key?: string) => Promise<PrefsAnswer>} reset
 * @property {(section: string, key: string) => Promise<PrefsAnswer>} chooseFolder
 * @property {(callback: (change: { section: string, values: Record<string, any> }) => void) => () => void} onChanged
 */
const bridge = /** @type {PrefsBridge | undefined} */ (/** @type {any} */ (window).transcribee?.prefs);
const STORAGE_KEY = "transcribee.prefs";

/** Whether the main process keeps the settings (false in a plain browser). */
export const hasMainProcess = Boolean(bridge);
/** What a folder setting's null means, by "section.key" (e.g. the Downloads folder). */
export const defaultPaths = bridge?.defaultPaths ?? {};

let values = normalizePrefsFile(bridge ? bridge.values : readLocal());
/** @type {Map<string, Set<(values: Record<string, any>) => void>>} */
const listeners = new Map();

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

function writeLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    // storage unavailable: the settings last for this session
  }
}

// Takes a section's new values and tells its listeners, if anything changed.
function update(id, next) {
  if (JSON.stringify(next) === JSON.stringify(values[id])) return;
  values = { ...values, [id]: next };
  for (const listener of listeners.get(id) ?? []) listener(next);
}

// Shows `next` at once, then sends the change to the main process and
// takes what it kept; if it refuses, puts the old values back and rejects.
async function change(id, next, send) {
  const before = values[id];
  update(id, next);
  if (!bridge) return writeLocal();
  const answer = await send();
  if (answer.ok) return update(id, answer.values);
  update(id, before);
  throw new Error(answer.error);
}

/** A section's values. @param {string} id */
export const getPrefs = (id) => values[id];

/**
 * Calls `listener` with the section's values after every change to them.
 * @param {string} id
 * @param {(values: Record<string, any>) => void} listener
 */
export function onPrefsChange(id, listener) {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id).add(listener);
  return () => listeners.get(id).delete(listener);
}

/**
 * Changes one setting. It shows at once; the main process then checks it,
 * saves it and answers with what it kept. Rejects if it was refused.
 * @param {string} id
 * @param {string} key
 * @param {unknown} value
 */
export async function setPref(id, key, value) {
  const next = setValue(getSection(id), values[id], key, value, { fromPage: true });
  await change(id, next, () => bridge.set(id, key, value));
}

/** Puts one setting (or, without `key`, the whole section) back to its default. */
export async function resetPref(id, key) {
  await change(id, resetValue(getSection(id), values[id], key), () => bridge.reset(id, key));
}

/** Lets the user pick a folder for a folder setting (main process only). */
export async function chooseFolder(id, key) {
  if (!bridge) return;
  const answer = await bridge.chooseFolder(id, key);
  if (!answer.ok) throw new Error(answer.error);
  update(id, answer.values);
}

// Changes made elsewhere: another window, or the main process.
bridge?.onChanged(({ section, values: next }) => {
  if (getSection(section)) update(section, normalizePrefsFile({ [section]: next })[section]);
});
