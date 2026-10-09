// Preferences ("Settings") on the main-process side: the one copy that
// counts, kept in prefs.json in the user-data folder. The sections and the
// checks are the page's (src/prefs, ES modules), loaded here with require().
//
// The page reaches it through the preload (window.transcribee.prefs): it
// reads every value at startup, asks to change one, and hears about every
// change, whoever made it. Everything the page sends is checked here, and a
// folder path is only ever set by the folder picker below, never sent by
// the page.
//
// prefs.json: { "version": 1, "<section id>": { "<key>": value, … }, … }
const fs = require("fs");
const path = require("path");
const prefs = require("../src/prefs/index.js");

const VERSION = 1;

// Brings what was stored up to VERSION. Version 0 is "no prefs.json yet":
// the theme was kept on its own, in theme.json (left in place).
function upgrade(stored, legacyThemeFile) {
  if (stored) return stored; // version 1; later versions add steps here
  const imported = {};
  try {
    if (legacyThemeFile) imported.theme = JSON.parse(fs.readFileSync(legacyThemeFile, "utf8"));
  } catch {
    // no theme.json (first run), or unreadable: the defaults
  }
  return imported;
}

/**
 * @param {string} file prefs.json
 * @param {{ legacyThemeFile?: string }} [options] theme.json, imported on the first run
 */
function createPrefsStore(file, { legacyThemeFile } = {}) {
  const listeners = new Set();
  let values = load();

  function load() {
    let stored = null;
    try {
      stored = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") console.warn("Couldn't read the settings; using the defaults:", error.message);
      if (error.code !== "ENOENT") stored = {}; // unreadable: the defaults, no import
    }
    return prefs.normalizePrefsFile(upgrade(stored, legacyThemeFile));
  }

  // Written to a temporary file, then renamed over the old one, so a crash
  // never leaves half a file.
  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ version: VERSION, ...values }, null, 2));
      fs.renameSync(temporary, file);
    } catch (error) {
      console.warn("Couldn't save the settings:", error);
    }
  }

  function section(id) {
    const found = prefs.getSection(id);
    if (!found) throw new prefs.PrefsError(`Unknown settings section: ${id}`);
    return found;
  }

  function commit(id, next) {
    if (JSON.stringify(next) === JSON.stringify(values[id])) return values[id];
    values = { ...values, [id]: next };
    save();
    for (const listener of listeners) listener(id, next);
    return next;
  }

  return {
    /** Every section's values. */
    all: () => values,
    /** @param {string} id */
    get: (id) => values[section(id).id],
    /**
     * Sets one value; throws a PrefsError if it's refused. `fromPage`
     * refuses what only the main process may set (folders).
     */
    set: (id, key, value, { fromPage = false } = {}) =>
      commit(id, prefs.setValue(section(id), values[id], key, value, { fromPage })),
    /** Back to the default: one key, or the whole section. */
    reset: (id, key) => commit(id, prefs.resetValue(section(id), values[id], key)),
    /** @param {(id: string, values: object) => void} listener Called after every change. */
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Answers the preload (see preload.js). Must be registered before any
 * window is created: the preload asks for the values synchronously while
 * the page starts, so it can apply the theme before anything is drawn.
 * @param {import("electron").IpcMain} ipcMain
 * @param {ReturnType<typeof createPrefsStore>} store
 * @param {object} options
 * @param {() => object} options.initialTheme What the preload applies first ({ scheme, variables }).
 * @param {Record<string, string>} options.defaultPaths What a folder field's null means, by "section.key".
 * @param {(sender: import("electron").WebContents, defaultPath: string) => Promise<string | null>} options.chooseFolder
 *   The native folder picker; null if canceled.
 * @param {() => import("electron").WebContents[]} options.pages Every page to tell about changes.
 */
function handlePrefs(ipcMain, store, { initialTheme, defaultPaths, chooseFolder, pages }) {
  // The preload waits for this answer (sendSync), so it must always get one.
  ipcMain.on("prefs:initial", (event) => {
    try {
      event.returnValue = { values: store.all(), defaultPaths, theme: initialTheme() };
    } catch (error) {
      console.warn("Couldn't read the settings:", error);
      event.returnValue = null; // the page falls back to the defaults
    }
  });

  // Answers { ok: true, values } (the section's values after the change)
  // or { ok: false, error }.
  const answer = (change) => {
    try {
      return { ok: true, values: change() };
    } catch (error) {
      if (!(error instanceof prefs.PrefsError)) console.error("Settings change failed:", error);
      return { ok: false, error: String(error?.message ?? error) };
    }
  };
  ipcMain.handle("prefs:set", (_event, id, key, value) => answer(() => store.set(id, key, value, { fromPage: true })));
  ipcMain.handle("prefs:reset", (_event, id, key) => answer(() => store.reset(id, key)));
  ipcMain.handle("prefs:choose-folder", async (event, id, key) => {
    const field = prefs.getSection(id)?.fields.find((candidate) => candidate.key === key);
    if (field?.type !== "folder") return { ok: false, error: `Not a folder setting: ${id}.${key}` };
    const chosen = await chooseFolder(event.sender, store.get(id)[key] ?? defaultPaths[`${id}.${key}`]);
    if (chosen === null) return { ok: true, values: store.get(id), canceled: true };
    return answer(() => store.set(id, key, chosen));
  });

  store.onChange((section, values) => {
    for (const page of pages()) if (!page.isDestroyed()) page.send("prefs:changed", { section, values });
  });
}

module.exports = { createPrefsStore, handlePrefs };
