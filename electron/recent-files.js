// Recent files: the projects and the songs or videos opened lately, newest
// first, kept in recent-files.json in the settings folder. Shown on the
// welcome screen and in the File menu (src/features/recent.js).
//
// The paths stay here. The page gets each entry's name, folder (to show)
// and id, and opens an entry by its id, so it never names a path itself; an
// id only means something while its file is on the list.
//
// Not a setting, in prefs.json: settings reach the page whole at startup,
// and each EarBee keeps its own copy of them, so a second EarBee would
// overwrite what the first one added. Here every operation reads the file
// first. All of it is synchronous, so operations in one process can't
// interleave; two processes at the same moment could still lose an entry,
// which doesn't matter for a list like this.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { CONFIG } = require("../src/config.js");

const VERSION = 1;
const EMPTY = { projects: [], files: [] };

/** @typedef {"projects" | "files"} RecentKind */
/** @typedef {{ id: string, name: string, folder: string }} RecentEntry What the page sees of an entry. */

// An id for a path: the same every time, and nothing to read a path from.
const idOf = (file) => crypto.createHash("sha256").update(file).digest("hex").slice(0, 16);

/** @returns {RecentEntry} */
const entryOf = (file) => ({ id: idOf(file), name: path.basename(file), folder: path.dirname(file) });

/**
 * @param {string} file Where the list is kept.
 * @param {{ max?: number }} [options]
 */
function createRecentFiles(file, { max = CONFIG.recent.max } = {}) {
  const listeners = new Set();

  // What can be used of a saved list: absolute paths, once each, as many as are kept.
  const clean = (list) =>
    Array.isArray(list)
      ? [...new Set(list.filter((item) => typeof item === "string" && path.isAbsolute(item)))].slice(0, max)
      : [];

  // A missing or damaged file is an empty list: nothing here is worth an error.
  function read() {
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      return { projects: clean(saved?.projects), files: clean(saved?.files) };
    } catch {
      return EMPTY;
    }
  }

  function write(lists) {
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify({ version: VERSION, ...lists }, null, 2));
      fs.renameSync(temporary, file);
    } catch (error) {
      console.warn("Couldn't save the recent files:", error);
    }
    for (const listener of listeners) listener();
  }

  const view = (lists) => ({ projects: lists.projects.map(entryOf), files: lists.files.map(entryOf) });

  return {
    /** Both lists, newest first, as the page sees them. */
    list: () => view(read()),

    /**
     * The entry with this id, or null if it isn't on a list.
     * @param {string} id
     * @returns {{ kind: RecentKind, path: string } | null}
     */
    find(id) {
      const lists = read();
      for (const kind of /** @type {RecentKind[]} */ (["projects", "files"])) {
        const found = lists[kind].find((item) => idOf(item) === id);
        if (found) return { kind, path: found };
      }
      return null;
    },

    /**
     * Puts `item` at the top of its list; it's there only once, and the oldest drop off.
     * @param {RecentKind} kind
     * @param {string} item
     */
    add(kind, item) {
      const lists = read();
      write({ ...lists, [kind]: clean([item, ...lists[kind]]) });
    },

    /** @param {string} id */
    remove(id) {
      const lists = read();
      const without = (list) => list.filter((item) => idOf(item) !== id);
      write({ projects: without(lists.projects), files: without(lists.files) });
    },

    clear: () => write(EMPTY),

    /** Calls `listener` after every change here. @param {() => void} listener */
    onChange(listener) {
      listeners.add(listener);
    },
  };
}

module.exports = { createRecentFiles };
