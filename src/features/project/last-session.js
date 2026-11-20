// The last session: what is open, kept as you go, so the next start can
// offer it back ("Pick up where you left off", on the welcome screen), after
// quitting or a crash, even if it was never saved as a project. The main
// process keeps it (electron/session-store.js); a project's own file is
// never written here, only its unsaved changes beside it.
//
// What is kept is every section's saved form (sections.js), as a project
// would save it, except the stems' bytes: those are copied once, when the
// stems are ready and nothing is playing, a stem at a time in idle moments
// (playback comes first). Stems the open project already has aren't copied
// at all: the session names them "project" ("file": the copy).
//
// When: a moment after any change (CONFIG.session.autosaveDelay), checked
// after the same inputs, clicks and keys as unsaved changes; now and then
// while playing, for the place; and as the page goes (closing, reloading),
// synchronously, so a normal quit always leaves the latest. A kill leaves
// the write before it. Only when something changed.
import { CONFIG } from "../../config.js";
import { hasAudio, marks, player } from "../../context.js";
import { formatWhen } from "../../core/format.js";
import { dom, element, onClick } from "../../ui/dom.js";
import { beatEvents } from "../beats.js";
import { stemsRevision, stemsStage, stemsToSave, whenPrepared } from "../stems/index.js";
import { SECTIONS } from "./sections.js";

/**
 * @typedef {object} SessionBridge
 * @property {(request: SessionRequest) => Promise<boolean>} write
 * @property {(request: SessionRequest) => boolean} writeFinal
 * @property {() => Promise<SessionSummary | null>} summary
 * @property {() => Promise<any>} open
 * @property {() => Promise<void>} forget
 * @property {() => Promise<{ ok: boolean, token?: string, error?: string }>} beginStems
 * @property {(token: string, id: string, bytes: Uint8Array) => Promise<{ ok: boolean, error?: string }>} addStem
 * @property {(token: string) => Promise<{ ok: boolean, error?: string }>} endStems
 *
 * @typedef {{ mediaUrl: string, sections: Record<string, any>, unsaved: boolean }} SessionRequest
 * @typedef {{ name: string, savedAt: number, project: string | null, unsaved: boolean }} SessionSummary
 * @typedef {"project" | "file"} StemsFrom Where the session's stems are: the open project's, or the copy.
 */

export const bridge = /** @type {SessionBridge | undefined} */ (/** @type {any} */ (window).earbee?.session);

/** What is open, from features/project/index.js. */
let current = () => /** @type {{ mediaUrl: string | null, unsaved: boolean }} */ ({ mediaUrl: null, unsaved: false });

// The stems' bytes the session can name, and where they are: their
// revision (features/stems/: it changes whenever new stems are separated,
// not when they're loaded) and "project" or "file". Null: none yet.
/** @type {{ revision: number, from: StemsFrom } | null} */
let named = null;
// The stems section as last kept, for while stems are loading (they have
// nothing to save until they've loaded, but they're still the session's).
/** @type {Record<string, any> | null} */
let keptStems = null;
let lastWritten = "";
let copying = false;

/* ---------- What is kept ---------- */

// The stems section with its audio named by `from` (or none, if it can't be).
function stemsSectionNow() {
  const section = SECTIONS.find((each) => each.id === "stems");
  if (!section) return null;
  if (stemsStage() === "load" && keptStems) return keptStems;
  const data = { ...section.capture(), version: section.version };
  if (!data.stems) return data;
  if (named && named.revision === stemsRevision().revision)
    return { ...data, stems: { ...data.stems, audio: named.from } };
  return { ...data, stems: null }; // new stems, not copied yet
}

function capture() {
  /** @type {Record<string, any>} */
  const sections = {};
  for (const section of SECTIONS) {
    if (section.id === "stems") continue;
    sections[section.id] = { ...section.capture(), version: section.version };
  }
  const stems = stemsSectionNow();
  if (stems) sections.stems = stems;
  return sections;
}

/** @returns {SessionRequest | null} */
function request() {
  const { mediaUrl, unsaved } = current();
  if (!bridge || !mediaUrl || !hasAudio()) return null;
  return { mediaUrl, sections: capture(), unsaved };
}

// Keeps the session now, if anything changed since the last time.
async function write() {
  const now = request();
  if (!now) return;
  copyStemsSoon();
  const text = JSON.stringify(now);
  if (text === lastWritten) return;
  lastWritten = text;
  if (!(await bridge?.write(now).catch(() => false))) lastWritten = "";
}

/** Keeps the session now, if anything changed (for the tests: how long it takes). */
export const keepNow = () => write();

let timer = 0;
/** Keeps the session in a moment (several changes in a row: once). */
export function scheduleWrite(delay = CONFIG.session.autosaveDelay) {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = 0;
    write().catch((error) => console.warn("Couldn't keep the session:", error));
  }, delay);
}

/* ---------- The stems' copy ---------- */

const idle = () =>
  new Promise((resolve) =>
    "requestIdleCallback" in window ? window.requestIdleCallback(resolve, { timeout: 2000 }) : setTimeout(resolve, 50),
  );

// New stems, ready: copied once, while nothing plays, a stem at a time.
function copyStemsSoon() {
  if (copying || !bridge || stemsStage() !== "ready") return;
  const { revision } = stemsRevision();
  if (named?.revision === revision || player.transport.playing) return;
  copying = true;
  copyStems(revision)
    .catch((error) => console.warn("Couldn't keep the stems for the last session:", error))
    .finally(() => {
      copying = false;
    });
}

async function copyStems(revision) {
  await whenPrepared();
  const saved = stemsToSave();
  if (!saved || saved.revision !== revision || !bridge) return;
  const stems = Object.entries(saved.audio ?? {}).filter(([, bytes]) => ArrayBuffer.isView(bytes));
  if (stems.length !== saved.ids.length) return; // not bytes (a project's, as they came): nothing to copy
  const begun = await bridge.beginStems();
  if (!begun.ok || !begun.token) return;
  for (const [id, bytes] of stems) {
    await idle();
    if (stemsRevision().revision !== revision) return; // newer ones came meanwhile: they'll be copied instead
    const added = await bridge.addStem(begun.token, id, /** @type {Uint8Array} */ (bytes));
    if (!added.ok) return;
  }
  if (!(await bridge.endStems(begun.token)).ok) return;
  named = { revision, from: "file" };
  scheduleWrite(0);
}

/* ---------- Sessions starting ---------- */

/**
 * A session has started (a file or project opened, or the last session
 * reopened): it's the last session from now on. `stems` is the stems
 * section it brought, and where their bytes are (null: none).
 * @param {{ stems?: Record<string, any> | null, stemsFrom?: StemsFrom | null }} [brought]
 */
export function sessionStarted({ stems = null, stemsFrom = null } = {}) {
  named = stemsFrom && stems?.stems ? { revision: stemsRevision().revision, from: stemsFrom } : null;
  keptStems = named && stems ? { ...stems, stems: { ...stems.stems, audio: stemsFrom } } : null;
  lastWritten = "";
  scheduleWrite(0);
}

/** The project was saved: its stems are in it now. */
export function projectSaved() {
  if (stemsToSave()) named = { revision: stemsRevision().revision, from: "project" };
  scheduleWrite(0);
}

/* ---------- The offer on the welcome screen ---------- */

/** @param {SessionSummary} summary @param {() => Promise<unknown>} open */
function renderOffer(summary, open) {
  const label = `Reopen “${summary.name}”`;
  const choose = element(
    "button",
    { type: "button", className: "recent-open", title: label },
    element("span", { className: "recent-icon" }),
    element(
      "span",
      { className: "recent-text" },
      element("span", { className: "recent-name" }, summary.name),
      element(
        "span",
        { className: "recent-folder" },
        [formatWhen(summary.savedAt, Date.now()), summary.unsaved ? "unsaved changes" : ""].filter(Boolean).join(" · "),
      ),
    ),
  );
  /** @type {HTMLElement} */ (choose.firstChild).innerHTML =
    `<svg class="icon" aria-hidden="true"><use href="#${summary.project ? "i-project" : "i-note"}" /></svg>`;
  onClick(choose, async () => {
    try {
      await open();
    } finally {
      if (!dom.welcome.hidden && !dom.welcome.contains(document.activeElement)) dom.welcomeOpen.focus();
    }
  });
  const forgetLabel = "Forget the last session";
  const forget = element("button", {
    type: "button",
    className: "recent-remove",
    title: forgetLabel,
    ariaLabel: forgetLabel,
  });
  forget.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-close" /></svg>`;
  onClick(forget, async () => {
    await bridge?.forget();
    dom.welcomeSession.hidden = true;
    dom.welcomeOpen.focus();
  });
  dom.welcomeSessionList.replaceChildren(element("li", {}, choose, forget));
  dom.welcomeSession.hidden = false;
}

/**
 * Starts keeping the session, and offers the last one on the welcome
 * screen; resolves once the offer is in place (the window shows with it).
 * @param {object} options
 * @param {() => { mediaUrl: string | null, unsaved: boolean }} options.session What is open.
 * @param {() => Promise<unknown>} options.open Reopens the last session.
 */
export async function bindLastSession({ session, open }) {
  if (!bridge) return;
  current = session;
  for (const type of ["input", "change", "click", "pointerup", "keyup"])
    window.addEventListener(type, () => scheduleWrite(), { capture: true });
  marks.on("change", () => scheduleWrite());
  beatEvents.on("found", () => scheduleWrite());
  player.transport.on("state", () => scheduleWrite());
  player.transport.on("jump", () => scheduleWrite());
  // While playing, the place now and then (nothing else changes it);
  // otherwise, stems that have become ready since.
  window.setInterval(() => {
    if (player.transport.playing) write().catch(() => {});
    else if (hasAudio()) copyStemsSoon();
  }, CONFIG.session.playingInterval);
  window.addEventListener("pagehide", () => {
    const now = request();
    if (now && JSON.stringify(now) !== lastWritten) bridge.writeFinal(now);
  });

  const summary = await bridge.summary().catch(() => null);
  if (summary) renderOffer(summary, open);
}
