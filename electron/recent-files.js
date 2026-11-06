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
const { answer, isFile } = require("./project-files");

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

/**
 * Answers the preload (see preload.js), and tells every page when a list changes.
 * @param {import("electron").IpcMain} ipcMain
 * @param {ReturnType<typeof createRecentFiles>} recentFiles
 * @param {object} options
 * @param {ReturnType<typeof import("./media-files").createMediaFiles>} options.mediaFiles
 * @param {ReturnType<typeof import("./project-files").createProjectFiles>} options.projectFiles
 * @param {() => import("electron").WebContents[]} options.pages
 */
function handleRecentFiles(ipcMain, recentFiles, { mediaFiles, projectFiles, pages }) {
  recentFiles.onChange(() => {
    const lists = recentFiles.list();
    for (const page of pages()) if (!page.isDestroyed()) page.send("recent:changed", lists);
  });

  ipcMain.handle("recent:list", () => recentFiles.list());

  // Opens an entry by its id: what project:open answers, for a project, or
  // a URL to read a song or video by. Checked first, because a shared file
  // that has gone only looks undecodable to the page. An entry whose file
  // has gone comes off the list, or it would stay there for good.
  ipcMain.handle("recent:open", (event, id) =>
    answer(async () => {
      const entry = recentFiles.find(String(id));
      if (!entry) return { ok: false, error: "That file isn't on the list any more." };
      if (!(await isFile(entry.path))) {
        recentFiles.remove(String(id));
        const error = `“${path.basename(entry.path)}” isn't in ${path.dirname(entry.path)} any more, so it's off the list.`;
        return { ok: false, error };
      }
      if (entry.kind === "projects") return projectFiles.open(event.sender, entry.path);
      return { ok: true, media: { name: path.basename(entry.path), url: mediaFiles.share(entry.path) } };
    }),
  );

  // What has just loaded, named by its URL. Only what the app itself shared
  // counts, so the page can't put a path of its own on the list: a project's
  // song lists the project, a whole file lists itself, and anything else
  // (one of a project's stems, say) isn't something to reopen.
  ipcMain.handle("recent:note", (_event, url) => {
    const source = mediaFiles.lookup(String(url));
    if (source?.project) recentFiles.add("projects", source.project);
    else if (source && source.offset === 0 && source.size === null) recentFiles.add("files", source.path);
  });

  ipcMain.handle("recent:remove", (_event, id) => {
    recentFiles.remove(String(id));
    return recentFiles.list();
  });
  ipcMain.handle("recent:clear", () => {
    recentFiles.clear();
    return recentFiles.list();
  });
}

module.exports = { createRecentFiles, handleRecentFiles };
