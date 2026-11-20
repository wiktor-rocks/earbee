// Project files (.ebee): saving the session (the open song or video's
// marks, sound settings, loop and place) and opening it back. What is
// saved is the list in sections.js; the file itself is src/project/format.js;
// reading and writing it, in the main process (electron/project-files.js),
// reached through window.earbee.project (electron/preload.js).
//
// Every file opened here (media or project) starts a session: untitled
// for a media file, named after the project for a project. It has
// unsaved changes when a section that `dirties` differs from what was last
// saved (or opened): compared after each input, click and key, so a new
// section needs no wiring of its own. The title then ends in •, and
// opening something else or closing the window asks first.
//
// With Settings › General › Save projects automatically, an open project
// also saves itself a moment after a change (never while playing): see
// "Saving by itself", below.
//
// Every session is also kept as you go, as the last session
// (last-session.js), which the welcome screen offers back on the next
// start; reopening it is openLastSession, below.
//
// Outside Electron (no bridge) media files still open; there is no saving.
import { CONFIG } from "../../config.js";
import { hasAudio, marks, player } from "../../context.js";
import { AppError } from "../../core/errors.js";
import { isProjectName } from "../../project/format.js";
import { dom, guarded, onClick, reportError, showNotice } from "../../ui/dom.js";
import { getPrefs, onPrefsChange } from "../../ui/prefs.js";
import { isTextField } from "../../ui/shortcuts.js";
import { notify } from "../../ui/toast.js";
import { beatEvents } from "../beats.js";
import { importChapters } from "../marks.js";
import { stemsStage } from "../stems/index.js";
import { loadMediaFile, withLoading } from "../open-file.js";
import { bindLastSession, bridge as lastSession, projectSaved, sessionStarted } from "./last-session.js";
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
const bridge = /** @type {ProjectBridge | undefined} */ (/** @type {any} */ (window).earbee?.project);

/**
 * Recent files (src/features/recent.js): only what opening needs.
 * @typedef {object} RecentBridge
 * @property {(id: string) => Promise<any>} open
 * @property {(url: string) => Promise<void>} note
 */
const recent = /** @type {RecentBridge | undefined} */ (/** @type {any} */ (window).earbee?.recent);

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

// What counts for unsaved changes: the sections that dirty (by their
// dirtyKey, if they have a cheaper one than all they save).
const dirtyingState = () =>
  JSON.stringify(
    SECTIONS.filter((section) => section.dirties).map((section) => (section.dirtyKey ?? section.capture)()),
  );

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
        throw new AppError(`${section.label} were saved by a newer EarBee`);
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
  document.title = name ? `EarBee — ${name}${session.dirty ? " •" : ""}` : "EarBee";
  dom.saveButton.classList.toggle("unsaved", session.dirty);
  dom.fileMenuButton.classList.toggle("unsaved", session.dirty);
}

function checkDirty() {
  const dirty = Boolean(bridge) && hasAudio() && (session.saved === null || dirtyingState() !== session.saved);
  if (dirty === session.dirty) {
    if (dirty) scheduleAutosave(); // a change more: the wait starts again
    return;
  }
  session.dirty = dirty;
  renderTitle();
  bridge?.setDirty(dirty, session.name ?? "");
  if (dirty) scheduleAutosave();
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

/* ---------- Saving by itself ---------- */

// Settings › General › Save projects automatically: a project (not a song
// that has never been saved: that takes Save As) saves itself, as Ctrl+S
// would, CONFIG.project.autosaveDelay after the last change. Not while
// playing: a save copies the stems (and the media, if it's inside), so it
// waits for a pause. Nor while a name is being typed, while the stems are
// being separated (each new part would mean another save), or while a
// save or the Save As dialog is going: it tries again a moment later.
// Quietly: the • going away says it's saved. A failure is shown once,
// not again for each change after it.
const autosaveOn = () => getPrefs("general")?.autosave === true;
const STEMS_BUSY = new Set(["download", "decode", "separate", "rest"]);
let autosaveTimer = 0;
let autosaving = false;
let autosaveError = "";
let failedState = null; // what a save by itself failed on: not tried again until it changes

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = 0;
  if (!autosaveOn() || !session.path || !session.dirty) return;
  if (failedState !== null && failedState === dirtyingState()) return;
  autosaveTimer = window.setTimeout(autosaveNow, CONFIG.project.autosaveDelay);
}

function autosaveWaits() {
  const focused = document.activeElement;
  return (
    player.transport.playing ||
    autosaving ||
    dom.saveDialog.open ||
    (focused instanceof HTMLElement && isTextField(focused)) ||
    STEMS_BUSY.has(stemsStage())
  );
}

async function autosaveNow() {
  autosaveTimer = 0;
  if (!autosaveOn() || !session.path || !session.dirty) return;
  if (autosaveWaits()) return scheduleAutosave();
  autosaving = true;
  try {
    await writeProject(session.path, session.embedded, { quiet: true });
    autosaveError = "";
    failedState = null;
  } catch (error) {
    const message = String(error?.message ?? error);
    if (message !== autosaveError) reportError(error);
    autosaveError = message;
    failedState = dirtyingState();
  } finally {
    autosaving = false;
    checkDirty(); // changed meanwhile: again, in a moment
  }
}

/**
 * Before what is open is replaced: if it has unsaved changes, Save / Don't
 * save / Cancel (a project that saves itself: saved, without asking).
 * Resolves true to go ahead.
 */
export async function confirmUnsaved() {
  checkDirty();
  if (!bridge || !session.dirty) return true;
  if (autosaveOn() && session.path) {
    clearTimeout(autosaveTimer);
    autosaveTimer = 0;
    return writeProject(session.path, session.embedded, { quiet: true }).catch((error) => {
      reportError(error);
      return false;
    });
  }
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
  // It opened, and has a place on this computer (a file dropped from
  // another program may not): it goes on the recent list.
  if (session.mediaUrl) recent?.note(session.mediaUrl);
  sessionStarted();
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
  recent?.note(opened.media.url);
  sessionStarted({ stems: opened.sections.stems, stemsFrom: "project" });
  return notices;
}

/**
 * The last session's sections over the project just loaded: only those
 * that differ from the project's own (bringing back the same beats or
 * stems again would count as a change, or load them twice).
 * @param {Record<string, any>} projectSections
 * @param {Record<string, any>} sessionSections
 */
function restoreChanges(projectSections, sessionSections) {
  const changed = Object.fromEntries(
    Object.entries(sessionSections).filter(
      ([id, data]) => JSON.stringify(data) !== JSON.stringify(projectSections[id]),
    ),
  );
  return restoreProject(changed, player.transport.duration);
}

/**
 * Reopens the last session (the welcome screen's offer): the song or video
 * as it was, or the project with its unsaved changes over it (the • shows
 * if there are any). If the project was saved since, as saved.
 */
export async function openLastSession() {
  if (!lastSession || !(await confirmUnsaved())) return;
  const opened = await lastSession.open();
  if (!opened.ok) {
    if (opened.error) throw new AppError(opened.error);
    return;
  }
  if (opened.kind === "media") {
    return withLoading(opened.media.name, async (signal) => {
      const notices = await loadMediaFile(opened.media, signal);
      await startMediaSession(opened.media);
      notices.push(...restoreProject(opened.sections, player.transport.duration));
      checkDirty();
      sessionStarted({ stems: opened.sections.stems, stemsFrom: opened.stemsFrom });
      showNotice(notices.join(" "));
      notify(`Reopened “${opened.media.name}”`);
    });
  }
  const project =
    /** @type {OpenedProject & { session: Record<string, any>, changedSince: boolean, stemsFrom: any }} */ (opened);
  return withLoading(project.name, async (signal) => {
    const notices = await loadProject(project, signal);
    if (project.changedSince) notices.push(`“${project.name}” was saved since, so it opened as saved.`);
    else {
      notices.push(...restoreChanges(project.sections, project.session));
      const stems = project.session.stems ?? project.sections.stems;
      sessionStarted({ stems, stemsFrom: project.stemsFrom ?? (project.sections.stems?.stems ? "project" : null) });
    }
    checkDirty();
    showNotice(notices.join(" "));
    notify(`Reopened “${project.name}”`);
  });
}

/**
 * Opens a file the user chose or dropped: a project, or a song or video.
 * @param {File | undefined} file
 */
export async function openFile(file) {
  if (!file || !(await confirmUnsaved())) return;
  if (!isProjectName(file.name)) return openMedia(file);
  if (!bridge) throw new AppError("Projects can only be opened in the EarBee app.");
  return showOpenedProject(await bridge.open(file));
}

/**
 * Opens an entry of the recent list (src/features/recent.js): the main
 * process finds it by its id, and answers a project (with its sections) or a
 * song or video to read by URL.
 * @param {string} id
 */
export async function openRecent(id) {
  if (!recent || !(await confirmUnsaved())) return;
  const opened = await recent.open(id);
  return opened.ok && !opened.sections ? openMedia(opened.media) : showOpenedProject(opened);
}

/** @param {import("../../core/media.js").Media} media */
const openMedia = (media) =>
  withLoading(media.name, async (signal) => {
    showNotice((await loadMedia(media, signal)).join(" "));
    notify(`Opened “${media.name}”`);
  });

/** What opening a project answered: loads it, or says why it couldn't be opened (nothing, if the user canceled). */
async function showOpenedProject(opened) {
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
 * true once it's saved. `quiet` (saving by itself): no notification, and
 * a name being typed isn't committed.
 * @param {string | null} file
 * @param {boolean} embed
 * @param {{ quiet?: boolean }} [options]
 */
async function writeProject(file, embed, { quiet = false } = {}) {
  if (!bridge || !hasAudio()) return false;
  if (!session.mediaUrl)
    throw new AppError(`“${session.mediaName}” isn't a file on this computer, so a project can't name it.`);
  // A name still being typed (Ctrl+S works in text fields) counts: its
  // field only commits on "change", which hasn't fired yet.
  const focused = document.activeElement;
  if (!quiet && focused instanceof HTMLElement && isTextField(focused)) focused.dispatchEvent(new Event("change"));
  // What a section is still making, first (sections.js, prepare).
  await Promise.all(SECTIONS.map((section) => section.prepare?.()));
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
  projectSaved();
  autosaveError = ""; // saved: a failure from before would be news again
  failedState = null;
  if (!quiet) notify("Project saved", result.path);
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

/**
 * Binds saving and opening; resolves once the welcome screen's offer of the
 * last session is in place.
 */
export function bindProject() {
  if (!bridge) return Promise.resolve(); // not in Electron: no saving
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
  beatEvents.on("found", scheduleDirtyCheck);
  // Saving by itself: turned on (with unsaved changes), or playback stopped.
  onPrefsChange("general", () => scheduleAutosave());
  player.transport.on("state", () => scheduleAutosave());

  // The window is closing and the user chose Save.
  bridge.onSaveThenClose(
    guarded(async () => {
      if (await saveProject()) bridge.close();
    }),
  );

  return bindLastSession({
    session: () => ({ mediaUrl: session.mediaUrl, unsaved: session.dirty }),
    open: openLastSession,
  });
}
