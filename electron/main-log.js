// The main process's warnings and errors, for the page's log (Settings ›
// Notifications, the master log a bug report copies; src/ui/problems.js).
//
// captureConsole wraps console.warn and console.error here: each still
// prints as before, and also becomes an entry, "Main: …", with an
// Error's stack as its detail. An entry goes to the page that asked for
// the log (log:pending) and is still there; with none (before the page
// loads, while it reloads after a crash) it waits, the newest `max`, and
// the next page to ask gets them. So the log also says why the page
// crashed (system.js logs it) once the reloaded page is up.
//
// forwardStderr does the same for a utility process (the beat model, the
// stems): its stderr, a burst of lines at a time, as one warning.
const util = require("util");

/** @typedef {{ time: number, kind: "warning" | "error", text: string, detail?: string }} MainLogEntry */

/** An Error as its stack (with its causes), anything else as text. */
function describe(value) {
  const parts = [];
  let current = value;
  for (let depth = 0; depth < 4 && current !== undefined; depth++) {
    if (depth > 0) parts.push("Caused by:");
    parts.push(
      current instanceof Error
        ? current.stack || `${current.name}: ${current.message}`
        : typeof current === "string"
          ? current
          : util.inspect(current, { depth: 3, breakLength: 120 }),
    );
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join("\n");
}

/** A console call's arguments as an entry's text and detail. @param {unknown[]} args */
function entryFor(args) {
  const [first, ...rest] = args;
  const text = first instanceof Error ? first.message : typeof first === "string" ? first : util.inspect(first);
  const details = (first instanceof Error ? [first, ...rest] : rest).map(describe).filter(Boolean);
  return details.length ? { text, detail: details.join("\n") } : { text };
}

/**
 * @param {{ max?: number, now?: () => number }} [options]
 */
function createMainLog({ max = 100, now = Date.now } = {}) {
  /** @type {MainLogEntry[]} */
  let waiting = [];
  /** The pages that asked, oldest first. @type {Set<Electron.WebContents>} */
  const pages = new Set();
  const watched = new WeakSet();

  const live = () => [...pages].find((contents) => !contents.isDestroyed() && !contents.isCrashed());

  /** @param {string} text @param {string} [detail] @param {"warning" | "error"} [kind] */
  function add(text, detail, kind = "warning") {
    /** @type {MainLogEntry} */
    const entry = { time: now(), kind, text };
    if (detail) entry.detail = detail;
    const page = live();
    if (page) {
      try {
        page.send("log:entry", entry);
        return;
      } catch {
        // Gone between the check and the send: it waits, below.
      }
    }
    waiting.push(entry);
    if (waiting.length > max) waiting = waiting.slice(waiting.length - max);
  }

  /**
   * A page asks for the log: what waited, and from now on each new one.
   * Reloading or closing ends that (the reloaded page asks again).
   * @param {Electron.WebContents} contents
   */
  function take(contents) {
    pages.add(contents);
    if (!watched.has(contents)) {
      watched.add(contents);
      const drop = () => pages.delete(contents);
      contents.on("did-start-loading", drop);
      contents.on("render-process-gone", drop);
      contents.once("destroyed", drop);
    }
    const taken = waiting;
    waiting = [];
    return taken;
  }

  return { add, take, waiting: () => [...waiting] };
}

/** The log captureConsole feeds, and the console's own warn, for forwardStderr. */
let captured = null;

/**
 * console.warn and console.error, also into `log` (console.error's as
 * errors).
 * @param {ReturnType<typeof createMainLog>} log
 * @param {Console} [target]
 */
function captureConsole(log, target = console) {
  let busy = false;
  captured = { log, warn: target.warn.bind(target) };
  for (const method of /** @type {const} */ (["warn", "error"])) {
    const original = target[method].bind(target);
    target[method] = (...args) => {
      original(...args);
      if (busy) return;
      busy = true;
      try {
        const { text, detail } = entryFor(args);
        log.add(`Main: ${text}`, detail, method === "error" ? "error" : "warning");
      } catch {
        // The log failed: the console has it.
      } finally {
        busy = false;
      }
    };
  }
}

/**
 * A utility process's line, printed as before and into the log under its
 * own name (not "Main: "). @param {string} text @param {string} [detail]
 */
function report(text, detail) {
  const print = captured?.warn ?? console.warn;
  print(text, ...(detail ? [detail] : []));
  captured?.log.add(text, detail);
}

/**
 * A utility process's stderr as warnings, "<name>: <first line>" with the
 * rest as the detail; lines that come together (within `gapMs`) are one.
 * The process must be forked with stderr piped.
 * @param {{ stderr?: NodeJS.ReadableStream | null }} child
 * @param {string} name
 * @param {{ gapMs?: number, warn?: (...args: unknown[]) => void }} [options]
 */
function forwardStderr(child, name, { gapMs = 500, warn = report } = {}) {
  if (!child.stderr) return;
  let text = "";
  let timer = null;
  const flush = () => {
    timer = null;
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    text = "";
    if (!lines.length) return;
    const [first, ...rest] = lines;
    warn(`${name}: ${first}`, rest.length ? rest.join("\n") : undefined);
  };
  child.stderr.on("data", (chunk) => {
    text += String(chunk);
    timer ??= setTimeout(flush, gapMs);
  });
  child.stderr.on("end", () => {
    if (timer) clearTimeout(timer);
    flush();
  });
}

/**
 * The log's IPC: what waited (log:pending), the app and system for the
 * top of a copied log (app:info), and Copy itself (clipboard:write: the
 * page's own clipboard needs the window focused, and a bug report's copy
 * must work).
 * @param {Electron.IpcMain} ipcMain
 * @param {ReturnType<typeof createMainLog>} log
 * @param {{ appInfo: () => object, clipboard: { writeText: (text: string) => void } }} options
 */
function handleMainLog(ipcMain, log, { appInfo, clipboard }) {
  ipcMain.handle("log:pending", (event) => log.take(event.sender));
  ipcMain.handle("app:info", () => appInfo());
  ipcMain.handle("clipboard:write", (_event, text) => clipboard.writeText(String(text)));
}

module.exports = { createMainLog, captureConsole, forwardStderr, handleMainLog, entryFor };
