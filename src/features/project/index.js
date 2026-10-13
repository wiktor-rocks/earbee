// Project files (.sbee): saving the session (the open song or video's
// marks, sound settings, loop and place) and opening it back. What is
// saved is the list in sections.js; the file itself is src/project/format.js;
// reading and writing it, in the main process (electron/project-files.js),
// reached through window.scribee.project (electron/preload.js).
//
// Every file opened here (media or project) starts a session: untitled
// for a media file, named after the project for a project. It has
// unsaved changes when a section that `dirties` differs from what was last
// saved (or opened): compared after each input, click and key, so a new
// section needs no wiring of its own. The title then ends in •, and
// opening something else or closing the window asks first.
//
// Outside Electron (no bridge) media files still open; there is no saving.
import { hasAudio, marks, player } from "../../context.js";
import { AppError } from "../../core/errors.js";
import { isProjectName } from "../../project/format.js";
import { dom, guarded, onClick, reportError, showNotice } from "../../ui/dom.js";
import { notify } from "../../ui/toast.js";
import { importChapters } from "../marks.js";
import { loadMediaFile, withLoading } from "../open-file.js";
import { SECTIONS } from "./sections.js";

/**
 * @typedef {object} OpenedProject
 * @property {string} path
 * @property {string} name
 * @property {Record<string, any>} sections
 * @property {{ name: string, url: string }} media
 * @property {boolean} embedded
 * @property {boolean} linkable
 * @property {boolean} relinked
 *
 * @typedef {object} ProjectBridge
 * @property {(file: File) => Promise<{ ok: boolean, url?: string, error?: string }>} registerMedia
 * @property {(file: File) => Promise<{ ok: boolean, canceled?: boolean, error?: string } & Partial<OpenedProject>>} open
 * @property {(request: object) => Promise<{ ok: boolean, canceled?: boolean, error?: string, path?: string,
 *   name?: string, embedded?: boolean, linkable?: boolean }>} save
 * @property {(name: string) => Promise<"save" | "discard" | "cancel">} confirm
 * @property {(dirty: boolean, name: string) => void} setDirty
 * @property {(callback: () => void) => () => void} onSaveThenClose
 * @property {() => void} close
 */
const bridge = /** @type {ProjectBridge | undefined} */ (/** @type {any} */ (window).scribee?.project);

// The session: what is open, and what was last saved.
const session = {
  mediaName: "",
  mediaUrl: null, // the media's URL in the main process, which a project names it by
  path: null, // the project file, once saved or opened
  name: null, // its file name
  embedded: false, // whether the media is inside it
  linkable: true, // false while the media is only inside a project
  saved: null, // the dirtying sections as last saved or opened (JSON); null: never
  dirty: false,
};

/* ---------- Capturing and restoring ---------- */

/** Every section's saved form, versioned. */
const captureProject = () =>
  Object.fromEntries(SECTIONS.map((section) => [section.id, { ...section.capture(), version: section.version }]));

// What counts for unsaved changes: the sections that dirty.
const dirtyingState = () =>
  JSON.stringify(SECTIONS.filter((section) => section.dirties).map((section) => section.capture()));

/**
 * Brings back saved sections; returns notices about the ones that couldn't be.
 * @param {Record<string, any>} saved
 * @param {number} duration
 */
function restoreProject(saved, duration) {
  const notices = [];
  for (const section of SECTIONS) {
    const data = saved[section.id];
    if (!data || typeof data !== "object") continue;
    try {
      if (Number.isInteger(data.version) && data.version > section.version)
        throw new AppError(`${section.label} were saved by a newer ScriBee`);
      section.restore(data, { duration });
    } catch (error) {
      console.warn(`Couldn't restore the project's "${section.id}":`, error);
      notices.push(`Couldn't bring back ${section.label}.`);
    }
  }
  return notices;
}

/* ---------- Unsaved changes ---------- */

function renderTitle() {
  const name = session.name ?? session.mediaName;
  document.title = name ? `ScriBee — ${name}${session.dirty ? " •" : ""}` : "ScriBee";
  dom.saveButton.classList.toggle("unsaved", session.dirty);
  dom.fileMenuButton.classList.toggle("unsaved", session.dirty);
}

function checkDirty() {
  const dirty = Boolean(bridge) && hasAudio() && (session.saved === null || dirtyingState() !== session.saved);
  if (dirty === session.dirty) return;
  session.dirty = dirty;
  renderTitle();
  bridge?.setDirty(dirty, session.name ?? "");
}

let checkPending = false;
function scheduleDirtyCheck() {
  if (checkPending) return;
  checkPending = true;
  requestAnimationFrame(() => {
    checkPending = false;
    checkDirty();
  });
}

// What is open now counts as saved.
function markSaved() {
  session.saved = dirtyingState();
  checkDirty();
  renderTitle();
}

/**
 * Before what is open is replaced: if it has unsaved changes, Save / Don't
 * save / Cancel. Resolves true to go ahead.
 */
export async function confirmUnsaved() {
  checkDirty();
  if (!bridge || !session.dirty) return true;
  const choice = await bridge.confirm(session.name ?? "");
  if (choice === "save") return saveProject();
  return choice === "discard";
}

/* ---------- Sessions ---------- */

// A media file opened on its own: a new, untitled session. Its URL in the
// main process is what a project will name it by (a download already has one).
/** @param {import("../../core/media.js").Media} media */
async function startMediaSession(media) {
  Object.assign(session, { mediaName: media.name, path: null, name: null, embedded: false, linkable: true });
  session.mediaUrl = "url" in media ? media.url : null;
  if (!session.mediaUrl && bridge && media instanceof File) {
    const registered = await bridge.registerMedia(media).catch(() => null);
    session.mediaUrl = registered?.ok ? registered.url : null;
  }
  markSaved();
}

/**
 * Loads a media file as a new session (also for downloads); returns the
 * notices to show. See loadMediaFile. A download's `chapters` become
 * regions, as part of what was opened (not an unsaved change).
 * @param {import("../../core/media.js").Media} media
 * @param {AbortSignal} signal
 * @param {{ chapters?: { start: number, end: number, title: string }[] }} [options]
 */
export async function loadMedia(media, signal, { chapters = [] } = {}) {
  const notices = await loadMediaFile(media, signal);
  const added = importChapters(chapters);
  if (added) notify(`Added ${added} chapter${added === 1 ? "" : "s"} as marks`);
  await startMediaSession(media);
  return notices;
}

/** @param {OpenedProject} opened @param {AbortSignal} signal */
async function loadProject(opened, signal) {
  const notices = await loadMediaFile(opened.media, signal);
  notices.push(...restoreProject(opened.sections, player.transport.duration));
  Object.assign(session, {
    mediaName: opened.media.name,
    mediaUrl: opened.media.url,
    path: opened.path,
    name: opened.name,
    embedded: opened.embedded,
    linkable: opened.linkable,
  });
  markSaved();
  // Found somewhere else: saving it again remembers where.
  if (opened.relinked) {
    session.saved = null;
    checkDirty();
    notices.push(`Found “${opened.media.name}”; save the project to remember where it is now.`);
  }
  return notices;
}

/**
 * Opens a file the user chose or dropped: a project, or a song or video.
 * @param {File | undefined} file
 */
export async function openFile(file) {
  if (!file || !(await confirmUnsaved())) return;
  if (isProjectName(file.name)) return openProjectFile(file);
  return withLoading(file.name, async (signal) => {
    showNotice((await loadMedia(file, signal)).join(" "));
    notify(`Opened “${file.name}”`);
  });
}

/** @param {File} file */
async function openProjectFile(file) {
  if (!bridge) throw new AppError("Projects can only be opened in the ScriBee app.");
  const opened = await bridge.open(file);
  if (!opened.ok) {
    if (opened.error) throw new AppError(opened.error);
    return;
  }
  const project = /** @type {OpenedProject} */ (opened);
  return withLoading(project.name, async (signal) => {
    showNotice((await loadProject(project, signal)).join(" "));
    notify(`Opened “${project.name}”`);
  });
}

/* ---------- Saving ---------- */

/**
 * Writes the project to `file` (null: the user picks where). Resolves
 * true once it's saved.
 * @param {string | null} file
 * @param {boolean} embed
 */
async function writeProject(file, embed) {
  if (!bridge || !hasAudio()) return false;
  if (!session.mediaUrl)
    throw new AppError(`“${session.mediaName}” isn't a file on this computer, so a project can't name it.`);
  const result = await bridge.save({
    file,
    mediaUrl: session.mediaUrl,
    embed,
    duration: player.transport.duration,
    sections: captureProject(),
  });
  if (!result.ok) {
    if (result.canceled) return false;
    throw new AppError(`Couldn't save the project: ${result.error}`);
  }
  Object.assign(session, {
    path: result.path,
    name: result.name,
    embedded: result.embedded,
    linkable: result.linkable,
  });
  markSaved();
  notify("Project saved", result.path);
  return true;
}

// The Save As dialog: link to the media, or put it inside; then the
// native Save dialog. Resolves true once it's saved.
export function saveProjectAs() {
  if (!bridge || !hasAudio()) return Promise.resolve(false);
  const { saveModeLink: link, saveModeEmbed: inside } = dom;
  link.disabled = !session.linkable;
  (session.embedded || !session.linkable ? inside : link).checked = true;
  dom.saveMediaName.textContent = session.mediaName;
  dom.saveLinkNote.hidden = session.linkable;

  return new Promise((resolve) => {
    dom.saveDialog.returnValue = "";
    dom.saveDialog.addEventListener(
      "close",
      () => {
        if (dom.saveDialog.returnValue !== "save") return resolve(false);
        writeProject(null, inside.checked).then(resolve, (error) => {
          reportError(error);
          resolve(false);
        });
      },
      { once: true },
    );
    dom.saveDialog.showModal();
    (inside.checked ? inside : link).focus();
  });
}

/** Saves where it was saved before, as it was; the first time, Save As. */
export function saveProject() {
  if (!session.path) return saveProjectAs();
  return writeProject(session.path, session.embedded).catch((error) => {
    reportError(error);
    return false;
  });
}

export const isSaveDialogOpen = () => dom.saveDialog.open;

export function bindProject() {
  if (!bridge) return; // not in Electron: no saving
  dom.saveButton.hidden = false;
  dom.saveAsButton.hidden = false;
  dom.welcomeProjectFormat.hidden = false;
  onClick(dom.saveButton, saveProject);
  onClick(dom.saveAsButton, saveProjectAs);
  onClick(dom.saveCancel, () => dom.saveDialog.close(""));
  dom.saveForm.addEventListener("submit", (event) => {
    event.preventDefault();
    dom.saveDialog.close("save");
  });

  // Anything the user does may change a section; check afterwards.
  for (const type of ["input", "change", "click", "pointerup", "keyup"])
    window.addEventListener(type, scheduleDirtyCheck, { capture: true });
  marks.on("change", scheduleDirtyCheck);

  // The window is closing and the user chose Save.
  bridge.onSaveThenClose(
    guarded(async () => {
      if (await saveProject()) bridge.close();
    }),
  );
}
