// Project files (.tbee) on the main-process side: reading, writing, and
// finding the media they belong to. What a project file is, is in
// src/project/format.js (shared with the page); what goes in its sections
// is the page's business (src/features/project/).
//
// The page reaches this through the preload (window.transcribee.project):
//   register-media  a media file the user opened (the preload finds its path
//                   from the File itself), so a project can link to it;
//                   answers its URL, as a download's (media-files.js)
//   open            a project file the user dropped or chose (path from the
//                   File, again). Its media is served by URL: a slice of the
//                   project when it's inside, else the linked file, looked
//                   for next to the project first (where it was relative to
//                   it), then where it was; if it's in neither, the user is
//                   asked where it is.
//   save            the header the page sends, plus the media's bytes when
//                   it goes inside, written to a temporary file then renamed
//                   over the target, so a crash never leaves half a file.
//                   With no path yet, the native Save dialog asks for one.
//   confirm         Save / Don't save / Cancel, before unsaved changes are lost.
//   dirty, close    whether the page has unsaved changes, for guardClose().
//
// The media the page plays is always named by the URL it got from here
// or from a download, never by a path the page sends.
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const project = require("../src/project/format.js");
const { sliceSize } = require("./media-files");

const HEADER_CHUNK = 64 * 1024;

/**
 * The header of the project file at `file` and where its media starts
 * (null if it isn't inside). Reads only as far as the header.
 * @param {string} file
 * @returns {Promise<{ text: string, mediaOffset: number | null, fileSize: number }>}
 */
async function readHeader(file) {
  const handle = await fs.promises.open(file, "r");
  try {
    const fileSize = (await handle.stat()).size;
    const chunks = [];
    let read = 0;
    while (read < Math.min(fileSize, project.MAX_HEADER_BYTES)) {
      const chunk = Buffer.alloc(Math.min(HEADER_CHUNK, project.MAX_HEADER_BYTES - read));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, read);
      if (bytesRead === 0) break;
      const end = project.findHeaderEnd(chunk.subarray(0, bytesRead));
      if (end !== -1) {
        chunks.push(chunk.subarray(0, end));
        return { text: Buffer.concat(chunks).toString("utf8"), mediaOffset: read + end + 1, fileSize };
      }
      chunks.push(chunk.subarray(0, bytesRead));
      read += bytesRead;
    }
    if (read < fileSize) throw new project.ProjectFormatError("This isn't a TranscriBee project.");
    return { text: Buffer.concat(chunks).toString("utf8"), mediaOffset: null, fileSize };
  } finally {
    await handle.close();
  }
}

/**
 * Where a linked project's media may be, in the order to try: where it was
 * relative to the project (the two moved together), then where it was.
 * @param {string} projectFile
 * @param {import("../src/project/format.js").ProjectMedia} media
 */
function mediaCandidates(projectFile, media) {
  const candidates = [];
  if (media.relativePath) candidates.push(path.resolve(path.dirname(projectFile), media.relativePath));
  if (media.path && path.isAbsolute(media.path)) candidates.push(media.path);
  // Last, a file of the same name next to the project.
  candidates.push(path.join(path.dirname(projectFile), path.basename(media.name)));
  return [...new Set(candidates)];
}

async function isFile(file) {
  try {
    return (await fs.promises.stat(file)).isFile();
  } catch {
    return false;
  }
}

/** The target with the .tbee extension. @param {string} file */
const withExtension = (file) => (project.isProjectName(file) ? file : `${file}.${project.PROJECT_EXTENSION}`);

/** The name a new project is offered under: the media's, as .tbee. @param {string} name */
const projectNameFor = (name) => `${path.parse(name).name || "Untitled"}.${project.PROJECT_EXTENSION}`;

// Renames `from` over `to`. On Windows a file still open for reading (the
// page reading the media inside the old project) can't be replaced at
// once, so it is retried for a moment.
async function replaceFile(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.promises.rename(from, to);
    } catch (error) {
      if (attempt >= 20 || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/**
 * @typedef {object} ProjectDialogs The native dialogs, passed in (the tests answer them themselves).
 * @property {(sender: any, defaultPath: string) => Promise<string | null>} save Save as: a path, or null if canceled.
 * @property {(sender: any, name: string, defaultPath: string) => Promise<string | null>} locate Where a missing media file is, or null.
 * @property {(sender: any, name: string) => Promise<"save" | "discard" | "cancel">} confirm Unsaved changes: what to do.
 */

/**
 * @param {object} options
 * @param {ReturnType<typeof import("./media-files").createMediaFiles>} options.mediaFiles
 * @param {ProjectDialogs} options.dialogs
 * @param {string} [options.appVersion]
 */
function createProjectFiles({ mediaFiles, dialogs, appVersion }) {
  async function findLinkedMedia(sender, projectFile, media) {
    for (const candidate of mediaCandidates(projectFile, media)) {
      if (await isFile(candidate)) return { file: candidate, relinked: false };
    }
    const located = await dialogs.locate(sender, media.name, path.dirname(projectFile));
    if (!located) return null;
    return { file: located, relinked: true };
  }

  return {
    /**
     * Opens the project at `file`: its sections, and its media's URL.
     * @param {any} sender
     * @param {string} file
     */
    async open(sender, file) {
      if (!project.isProjectName(file)) throw new project.ProjectFormatError("This isn't a TranscriBee project.");
      const header = await readHeader(file);
      const { media, sections } = project.parseProject(header.text);
      const opened = { ok: true, path: file, name: path.basename(file), sections, embedded: media.embedded };
      // The media inside is served as a slice of the project; a linked file whole.
      if (media.embedded) {
        if (header.mediaOffset === null)
          throw new project.ProjectFormatError("This project should have its song or video inside, but it's missing.");
        const slice = { offset: header.mediaOffset, size: header.fileSize - header.mediaOffset, name: media.name };
        const url = mediaFiles.share(file, slice);
        return { ...opened, media: { name: media.name, url }, linkable: false, relinked: false };
      }
      const found = await findLinkedMedia(sender, file, media);
      if (!found) return { ok: false, canceled: true };
      const name = path.basename(found.file);
      return {
        ...opened,
        media: { name, url: mediaFiles.share(found.file) },
        linkable: true,
        relinked: found.relinked,
      };
    },

    /**
     * Writes a project. `mediaUrl` names the media being played (from
     * share()); `file` is where to write, or null to ask.
     * @param {any} sender
     * @param {{ file: string | null, mediaUrl: string, embed: boolean, duration: number, sections: object }} request
     */
    async save(sender, { file, mediaUrl, embed, duration, sections }) {
      const source = mediaFiles.lookup(mediaUrl);
      if (!source) throw new Error("The song or video being played isn't one the project can name.");
      const linkable = source.offset === 0 && source.size === null;
      if (!embed && !linkable)
        throw new project.ProjectFormatError(
          "This song or video is inside its project, so a new project must have it inside too.",
        );
      let target = file;
      if (!target) {
        const folder = path.dirname(source.path);
        const chosen = await dialogs.save(sender, path.join(folder, projectNameFor(source.name)));
        if (!chosen) return { ok: false, canceled: true };
        target = withExtension(chosen);
      }
      if (path.resolve(target) === path.resolve(source.path) && linkable)
        throw new project.ProjectFormatError("A project can't be saved over its own song or video.");

      const size = await sliceSize(source);
      const media = {
        name: source.name,
        path: embed ? null : source.path,
        relativePath: embed ? null : path.relative(path.dirname(target), source.path),
        size,
        duration,
        embedded: embed,
      };
      const headerBytes = Buffer.from(project.serializeProject({ media, sections, appVersion }), "utf8");

      const temporary = `${target}.${process.pid}-${Date.now()}.tmp`;
      try {
        await fs.promises.writeFile(temporary, headerBytes);
        if (embed) {
          await fs.promises.appendFile(temporary, Buffer.from([project.MEDIA_SEPARATOR]));
          if (size > 0) {
            await pipeline(
              fs.createReadStream(source.path, { start: source.offset, end: source.offset + size - 1 }),
              fs.createWriteStream(temporary, { flags: "a" }),
            );
          }
        }
        await replaceFile(temporary, target);
      } catch (error) {
        await fs.promises.rm(temporary, { force: true });
        throw error;
      }
      // The page goes on reading its media by the same URL; once it's
      // inside the new file, from there (the old one may have been replaced).
      if (embed) mediaFiles.update(mediaUrl, { path: target, offset: headerBytes.length + 1, size, name: source.name });
      return { ok: true, path: target, name: path.basename(target), embedded: embed, linkable };
    },
  };
}

/**
 * Answers the preload (see preload.js).
 * @param {import("electron").IpcMain} ipcMain
 * @param {ReturnType<typeof createProjectFiles>} projectFiles
 * @param {object} options
 * @param {ReturnType<typeof import("./media-files").createMediaFiles>} options.mediaFiles
 * @param {ProjectDialogs} options.dialogs
 * @param {Map<number, { dirty: boolean, name: string }>} options.state Each page's unsaved state, by webContents id.
 */
function handleProjects(ipcMain, projectFiles, { mediaFiles, dialogs, state }) {
  // Answers { ok: true, … } or { ok: false, error }.
  const answer = async (work) => {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof project.ProjectFormatError) && error?.code !== "ENOENT")
        console.error("Project file failed:", error);
      const message =
        error?.code === "ENOENT"
          ? "That file isn't there any more."
          : error?.code === "EACCES" || error?.code === "EPERM"
            ? "TranscriBee isn't allowed to write there."
            : String(error?.message ?? error);
      return { ok: false, error: message };
    }
  };

  ipcMain.handle("project:register-media", async (_event, file) =>
    answer(async () => {
      if (typeof file !== "string" || !path.isAbsolute(file) || !(await isFile(file)))
        return { ok: false, error: "Not a file." };
      return { ok: true, url: mediaFiles.share(file) };
    }),
  );
  ipcMain.handle("project:open", (event, file) => answer(() => projectFiles.open(event.sender, String(file ?? ""))));
  ipcMain.handle("project:save", (event, request) =>
    answer(() =>
      projectFiles.save(event.sender, {
        file: typeof request?.file === "string" && path.isAbsolute(request.file) ? request.file : null,
        mediaUrl: String(request?.mediaUrl ?? ""),
        embed: request?.embed === true,
        duration: Number(request?.duration) || 0,
        sections: request?.sections && typeof request.sections === "object" ? request.sections : {},
      }),
    ),
  );
  ipcMain.handle("project:confirm", (event, name) => dialogs.confirm(event.sender, String(name ?? "")));
  ipcMain.on("project:dirty", (event, dirty, name) => {
    state.set(event.sender.id, { dirty: dirty === true, name: String(name ?? "") });
  });
}

/**
 * Before `win` closes with unsaved changes: Save / Don't save / Cancel.
 * Save asks the page to save, which closes the window once it has
 * ("project:close"); Cancel keeps it open.
 * @param {import("electron").BrowserWindow} win
 * @param {object} options
 * @param {import("electron").IpcMain} options.ipcMain
 * @param {ProjectDialogs} options.dialogs
 * @param {Map<number, { dirty: boolean, name: string }>} options.state
 */
function guardClose(win, { ipcMain, dialogs, state }) {
  const contents = win.webContents;
  const id = contents.id;
  let asking = false;
  // A reload starts the page afresh: nothing unsaved.
  contents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) state.delete(id);
  });
  win.on("closed", () => state.delete(id));
  win.on("close", async (event) => {
    const page = state.get(id);
    if (!page?.dirty) return;
    event.preventDefault();
    if (asking) return;
    asking = true;
    try {
      const choice = await dialogs.confirm(contents, page.name);
      if (choice === "save") contents.send("project:save-then-close");
      else if (choice === "discard") {
        state.delete(id);
        win.close();
      }
    } finally {
      asking = false;
    }
  });
  const close = (event) => {
    if (event.sender !== contents) return;
    state.delete(id);
    win.close();
  };
  ipcMain.on("project:close", close);
  win.on("closed", () => ipcMain.removeListener("project:close", close));
}

module.exports = { createProjectFiles, handleProjects, guardClose, readHeader, mediaCandidates, projectNameFor };
