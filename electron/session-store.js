// The last session: what was open in EarBee, kept as you go, so the next
// start can offer it back on the welcome screen ("Pick up where you left
// off", src/features/project/last-session.js), after quitting or a crash,
// even if it was never saved as a project.
//
// It lives in the settings folder, in last-session/:
//   session.json   what the page sends (every section's saved form, the
//                  stems' bytes left out), plus where the song or video is
//                  and the project it belongs to, if any. Written whole to a
//                  temporary file, then renamed over the old one, so a
//                  crash never leaves half of it.
//   stems-<id>.bin the stems' Opus bytes, one after the other, written once
//                  when they're ready (a stem per message, so no message is
//                  big). session.json says which file and where each is.
//
// A saved project's file is never written here: its unsaved changes are
// kept in session.json, and reopening opens the project, then puts them
// back over it. Stems the project already has aren't copied ("project").
//
// One last session per computer: whichever window wrote last. Like the
// recent files, the page never names a path: the song or video is named by
// the URL it plays it from (media-files.js), and the project is the one that
// URL belongs to.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const project = require("../src/project/format.js");
const { answer, isFile } = require("./project-files");

const FORMAT = "earbee-session";
const VERSION = 1;
const STEMS_PREFIX = "stems-";
const STEMS_SUFFIX = ".bin";
// What the page names stems by in session.json: the open project's own, or
// the ones in this folder.
const FROM_PROJECT = "project";
const FROM_FILE = "file";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isStemsName = (name) =>
  typeof name === "string" && /^stems-[0-9a-f-]{36}\.bin$/.test(name) && path.basename(name) === name;

/**
 * What can be used of a saved session.json, or null.
 * @param {any} data
 */
function parseSession(data) {
  if (!isObject(data) || data.format !== FORMAT || !Number.isInteger(data.version) || data.version > VERSION)
    return null;
  const media = data.media;
  if (!isObject(media) || typeof media.path !== "string" || !path.isAbsolute(media.path)) return null;
  const whole = (value) => Number.isInteger(value) && value >= 0;
  return {
    savedAt: Number.isFinite(data.savedAt) ? data.savedAt : 0,
    name: typeof data.name === "string" ? data.name : path.basename(media.path),
    unsaved: data.unsaved === true,
    media: {
      path: media.path,
      name: typeof media.name === "string" ? media.name : path.basename(media.path),
      offset: whole(media.offset) ? media.offset : 0,
      size: whole(media.size) ? media.size : null,
    },
    project:
      isObject(data.project) && typeof data.project.path === "string" && path.isAbsolute(data.project.path)
        ? { path: data.project.path, mtimeMs: Number(data.project.mtimeMs) || 0 }
        : null,
    sections: isObject(data.sections) ? data.sections : {},
    stems:
      isObject(data.stems) && isStemsName(data.stems.file) && isObject(data.stems.blobs)
        ? { file: data.stems.file, blobs: data.stems.blobs }
        : null,
  };
}

/**
 * The stems' audio in a section's saved form: `audio` is "project" or "file"
 * (what the page writes), or holds the bytes or URLs. Replaces it with what
 * `resolve(marker)` gives; left as it is where that's undefined.
 * @param {Record<string, any>} sections
 * @param {(marker: string) => any} resolve
 */
function resolveStemsAudio(sections, resolve) {
  const stems = sections?.stems?.stems;
  if (!isObject(stems) || typeof stems.audio !== "string") return sections;
  const audio = resolve(stems.audio);
  if (audio === undefined) return sections;
  return { ...sections, stems: { ...sections.stems, stems: audio === null ? null : { ...stems, audio } } };
}

/**
 * @param {string} folder Where the last session is kept (userData/last-session).
 * @param {object} options
 * @param {ReturnType<typeof import("./media-files").createMediaFiles>} options.mediaFiles
 * @param {ReturnType<typeof import("./project-files").createProjectFiles>} options.projectFiles
 * @param {() => number} [options.now]
 */
function createSessionStore(folder, { mediaFiles, projectFiles, now = Date.now }) {
  const file = path.join(folder, "session.json");
  // Each window's stems file (its name) and where each stem is in it.
  /** @type {Map<number, { file: string, blobs: Record<string, { offset: number, size: number }> }>} */
  const stemsOf = new Map();
  // Stems files being written, by their token: the window, the name, where each is.
  /** @type {Map<string, { owner: number, file: string, at: number, blobs: Record<string, { offset: number, size: number }>, done: Promise<void> }>} */
  const writing = new Map();

  function read() {
    try {
      return parseSession(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      return null;
    }
  }

  // Each write has its number; a write that a newer one has overtaken
  // doesn't land (the final write, synchronous, overtakes any still going).
  let latest = 0;
  let queue = Promise.resolve();

  // The main process also serves the song or video to the page, so a write
  // never holds it up: asynchronous, one after the other. Except the last
  // one as a window closes (`final`), done before the app can quit.
  function writeFile(data, final) {
    const number = ++latest;
    const text = JSON.stringify(data);
    const temporary = `${file}.${process.pid}-${number}.tmp`;
    if (final) {
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(temporary, text);
      fs.renameSync(temporary, file);
      return Promise.resolve();
    }
    queue = queue.then(async () => {
      if (number !== latest) return;
      try {
        await fs.promises.mkdir(folder, { recursive: true });
        await fs.promises.writeFile(temporary, text);
        if (number === latest) await fs.promises.rename(temporary, file);
      } finally {
        await fs.promises.rm(temporary, { force: true });
      }
    });
    return queue;
  }

  // Stems files nobody uses any more: not in session.json, not a window's,
  // not being written. (Another EarBee's, being written right now, is left
  // alone for an hour.)
  function tidy() {
    const kept = new Set([read()?.stems?.file, ...[...stemsOf.values()].map((stems) => stems.file)]);
    for (const { file: name } of writing.values()) kept.add(`${name}.tmp`);
    let names;
    try {
      names = fs.readdirSync(folder);
    } catch {
      return; // no folder yet
    }
    for (const name of names) {
      if (!name.startsWith(STEMS_PREFIX) || kept.has(name)) continue;
      const full = path.join(folder, name);
      try {
        if (now() - fs.statSync(full).mtimeMs > 60 * 60 * 1000 || !name.endsWith(".tmp")) fs.rmSync(full);
      } catch {
        // gone already
      }
    }
  }

  return {
    /**
     * What the welcome screen offers: the name, when, the project's name
     * (null: none) and whether it had unsaved changes; null if there's
     * nothing to offer.
     */
    summary() {
      const saved = read();
      if (!saved) return null;
      return {
        name: saved.project ? path.basename(saved.project.path) : saved.name,
        savedAt: saved.savedAt,
        project: saved.project ? path.basename(saved.project.path) : null,
        unsaved: saved.unsaved,
      };
    },

    /**
     * Keeps what `sender`'s page has open; resolves to whether it was kept.
     * With `final` (as a window closes), done before it returns. Nothing is
     * kept for media the app didn't share (a dropped file with no place on
     * this computer).
     * @param {any} sender
     * @param {{ mediaUrl: string, sections: Record<string, any>, unsaved: boolean }} request
     * @param {{ final?: boolean }} [options]
     */
    async write(sender, { mediaUrl, sections, unsaved }, { final = false } = {}) {
      const source = mediaFiles.lookup(mediaUrl);
      if (!source || !isObject(sections)) return false;
      const projectFile = source.project && project.isProjectName(source.project) ? source.project : null;
      let mtimeMs = 0;
      if (projectFile) {
        try {
          mtimeMs = fs.statSync(projectFile).mtimeMs;
        } catch {
          return false; // the project has gone: nothing to come back to
        }
      }
      const stemsMarker = sections.stems?.stems?.audio;
      const stems = stemsMarker === FROM_FILE ? (stemsOf.get(sender.id) ?? null) : null;
      // Stems said to be in a file there isn't: none (they'll be written again).
      const kept = stemsMarker === FROM_FILE && !stems ? resolveStemsAudio(sections, () => null) : sections;
      const before = read()?.stems?.file ?? null;
      const written = writeFile(
        {
          format: FORMAT,
          version: VERSION,
          savedAt: now(),
          name: source.name,
          unsaved: unsaved === true,
          media: { path: source.path, name: source.name, offset: source.offset, size: source.size },
          project: projectFile ? { path: projectFile, mtimeMs } : null,
          sections: kept,
          stems,
        },
        final,
      );
      await written;
      // An older copy of the stems isn't named any more: it goes.
      if (before && before !== stems?.file) tidy();
      return true;
    },

    /**
     * Starts writing `sender`'s stems to a new file; answers its token.
     * @param {any} sender
     */
    beginStems(sender) {
      fs.mkdirSync(folder, { recursive: true });
      const token = crypto.randomUUID();
      const name = `${STEMS_PREFIX}${token}${STEMS_SUFFIX}`;
      fs.writeFileSync(path.join(folder, `${name}.tmp`), "");
      writing.set(token, { owner: sender.id, file: name, at: 0, blobs: {}, done: Promise.resolve() });
      return token;
    },

    /**
     * One stem's bytes, after the ones before.
     * @param {any} sender
     * @param {string} token
     * @param {string} id the blob's id (src/project/format.js, extractBlobs)
     * @param {Uint8Array} bytes
     */
    async addStem(sender, token, id, bytes) {
      const stems = writing.get(token);
      if (!stems || stems.owner !== sender.id || typeof id !== "string" || !ArrayBuffer.isView(bytes))
        throw new Error("Not a stems file being written.");
      const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      stems.blobs[id] = { offset: stems.at, size: data.byteLength };
      stems.at += data.byteLength;
      stems.done = stems.done.then(() => fs.promises.appendFile(path.join(folder, `${stems.file}.tmp`), data));
      await stems.done;
    },

    /**
     * The stems file is complete: from now on, `sender`'s session names it.
     * @param {any} sender
     * @param {string} token
     */
    async endStems(sender, token) {
      const stems = writing.get(token);
      if (!stems || stems.owner !== sender.id) throw new Error("Not a stems file being written.");
      await stems.done;
      writing.delete(token);
      fs.renameSync(path.join(folder, `${stems.file}.tmp`), path.join(folder, stems.file));
      stemsOf.set(sender.id, { file: stems.file, blobs: stems.blobs });
      tidy();
    },

    /**
     * Opens the last session for `sender`: { ok: true, kind: "media",
     * media, sections } or, with a project, what project-files.js open()
     * answers plus `session` (its sections) and `changedSince` (the
     * project was saved since: its unsaved changes are left out).
     * @param {any} sender
     */
    async open(sender) {
      const saved = read();
      if (!saved) return { ok: false, error: "There's no last session to open." };
      // The stems in this folder, each as a slice to read it from.
      const stemsFile = saved.stems && path.join(folder, saved.stems.file);
      const fromFile = () => {
        if (!saved.stems || !fs.existsSync(/** @type {string} */ (stemsFile))) return null;
        const audio = {};
        for (const [id, place] of Object.entries(saved.stems.blobs)) {
          if (!isObject(place) || !Number.isInteger(place.offset) || !Number.isInteger(place.size)) return null;
          const stem = id.split("/").at(-1) ?? id;
          audio[stem] = {
            url: mediaFiles.share(/** @type {string} */ (stemsFile), { ...place, name: id }),
            size: place.size,
          };
        }
        return audio;
      };
      const keepStems = () => {
        if (saved.stems && fs.existsSync(/** @type {string} */ (stemsFile)))
          stemsOf.set(sender.id, { file: saved.stems.file, blobs: saved.stems.blobs });
      };

      if (saved.project) {
        if (!(await isFile(saved.project.path)))
          return { ok: false, error: `“${path.basename(saved.project.path)}” isn't there any more.` };
        const opened = await projectFiles.open(sender, saved.project.path);
        if (!opened.ok) return opened;
        const changedSince = (await fs.promises.stat(saved.project.path)).mtimeMs !== saved.project.mtimeMs;
        const projectAudio = /** @type {any} */ (opened).sections?.stems?.stems?.audio;
        const session = changedSince
          ? {}
          : resolveStemsAudio(saved.sections, (marker) =>
              marker === FROM_PROJECT ? (isObject(projectAudio) ? projectAudio : null) : fromFile(),
            );
        if (!changedSince) keepStems();
        const marker = saved.sections?.stems?.stems?.audio;
        const stemsFrom = changedSince ? null : marker === FROM_FILE && !stemsOf.has(sender.id) ? null : marker;
        return { ...opened, session, changedSince, stemsFrom: typeof stemsFrom === "string" ? stemsFrom : null };
      }

      if (!(await isFile(saved.media.path)))
        return { ok: false, error: `“${saved.media.name}” isn't in ${path.dirname(saved.media.path)} any more.` };
      const whole = saved.media.offset === 0 && saved.media.size === null;
      const url = mediaFiles.share(
        saved.media.path,
        whole ? {} : { offset: saved.media.offset, size: saved.media.size, name: saved.media.name },
      );
      keepStems();
      const sections = resolveStemsAudio(saved.sections, (marker) => (marker === FROM_FILE ? fromFile() : null));
      const stemsFrom = sections.stems?.stems && saved.sections?.stems?.stems?.audio === FROM_FILE ? FROM_FILE : null;
      return { ok: true, kind: "media", media: { name: saved.media.name, url }, sections, stemsFrom };
    },

    /** Forgets the last session (the offer's ×). */
    forget() {
      fs.rmSync(file, { force: true });
      tidy();
    },

    /** A window has closed: its stems file is no longer its. @param {number} id */
    closed(id) {
      stemsOf.delete(id);
      for (const [token, stems] of writing) if (stems.owner === id) writing.delete(token);
    },

    tidy,
  };
}

/**
 * Answers the preload (see preload.js).
 * @param {import("electron").IpcMain} ipcMain
 * @param {ReturnType<typeof createSessionStore>} sessions
 */
function handleSessions(ipcMain, sessions) {
  const plain = (request) => ({
    mediaUrl: String(request?.mediaUrl ?? ""),
    sections: isObject(request?.sections) ? request.sections : {},
    unsaved: request?.unsaved === true,
  });
  const failed = (error) => {
    console.warn("Couldn't keep the session:", error);
    return false;
  };
  ipcMain.handle("session:write", (event, request) => sessions.write(event.sender, plain(request)).catch(failed));
  // As the page goes (closing, reloading): answered once it's written. (A
  // final write does its file work before its promise is made.)
  ipcMain.on("session:write-final", (event, request) => {
    sessions.write(event.sender, plain(request), { final: true }).catch(failed);
    event.returnValue = true;
  });
  ipcMain.handle("session:summary", () => sessions.summary());
  ipcMain.handle("session:open", (event) => answer(() => sessions.open(event.sender)));
  ipcMain.handle("session:forget", () => sessions.forget());
  ipcMain.handle("session:stems-begin", (event) =>
    answer(async () => ({ ok: true, token: sessions.beginStems(event.sender) })),
  );
  ipcMain.handle("session:stems-add", (event, token, id, bytes) =>
    answer(async () => (await sessions.addStem(event.sender, String(token), String(id), bytes), { ok: true })),
  );
  ipcMain.handle("session:stems-end", (event, token) =>
    answer(async () => (await sessions.endStems(event.sender, String(token)), { ok: true })),
  );
}

module.exports = { createSessionStore, handleSessions, parseSession, resolveStemsAudio, FROM_PROJECT, FROM_FILE };
