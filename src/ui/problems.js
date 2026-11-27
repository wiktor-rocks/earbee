/* =====================================================================
 * PROBLEMS BEHIND THE SCENES, INTO THE LOG
 * Settings › Notifications is the master log a bug report copies
 * (features/notification-log.js). Besides the cards (ui/toast.js), it
 * takes, with no card:
 *   - every console.warn and console.error on the page, as a "warning"
 *     (the console still gets them too); a worker's come through its
 *     host's console.warn (video/view.js);
 *   - an error nothing caught, or a promise nobody handled, as an
 *     "error" with its stack;
 *   - the main process's warnings and errors, and its utility processes'
 *     (electron/main-log.js), including the ones from before the page
 *     loaded, such as the page's own crash before a reload.
 * captureProblems() starts it, first thing in app.js's start().
 * reportError (ui/dom.js) logs its error itself, with its stack, so its
 * console.error runs quietly() and isn't logged twice.
 * ===================================================================== */

import { consoleEntry, describe } from "../core/notification-log.js";
import { logEntry, logProblem } from "./toast.js";

let quiet = 0; // inside quietly()
let busy = false; // logging one: a warning while logging isn't logged again

/**
 * Runs `fn` without its console warnings and errors going to the log.
 * @template T @param {() => T} fn @returns {T}
 */
export function quietly(fn) {
  quiet++;
  try {
    return fn();
  } finally {
    quiet--;
  }
}

/** @param {() => void} log */
function once(log) {
  if (busy || quiet) return;
  busy = true;
  try {
    log();
  } catch {
    // The log itself failed: the console has it already.
  } finally {
    busy = false;
  }
}

let started = false;

export function captureProblems() {
  if (started) return;
  started = true;

  for (const method of /** @type {const} */ (["warn", "error"])) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      original(...args);
      once(() => {
        const { text, detail } = consoleEntry(args);
        logProblem(text, detail);
      });
    };
  }

  window.addEventListener("error", (event) => {
    once(() =>
      logEntry({
        kind: "error",
        text: `Unexpected error: ${event.error?.message ?? (event.message || "unknown")}`,
        detail: event.error ? describe(event.error) : `${event.filename}:${event.lineno}:${event.colno}`,
      }),
    );
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    once(() =>
      logEntry({
        kind: "error",
        text: `Unexpected error: ${reason?.message ?? String(reason)}`,
        detail: describe(reason),
      }),
    );
  });

  // The main process's (Electron only): what came before the page, then
  // as it comes. Each keeps its own time.
  /**
   * window.earbee.mainLog (electron/preload.js); missing outside Electron.
   * @type {{ pending: () => Promise<{ time: number, kind?: string, text: string, detail?: string }[]>,
   *   onEntry: (listener: (entry: { time: number, kind?: string, text: string, detail?: string }) => void) => void } | undefined}
   */
  const mainLog = /** @type {any} */ (window).earbee?.mainLog;
  if (mainLog) {
    /** @param {{ time: number, kind?: string, text: string, detail?: string }} entry */
    const take = (entry) =>
      once(() =>
        logEntry({
          time: entry.time,
          kind: entry.kind === "error" ? "error" : "warning",
          text: entry.text,
          detail: entry.detail,
        }),
      );
    mainLog.onEntry(take);
    mainLog
      .pending()
      .then((entries) => entries.forEach(take))
      .catch(() => {}); // no main log to read: nothing more to take
  }
}
