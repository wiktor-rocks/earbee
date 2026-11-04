// Updates: a packaged EarBee checks GitHub for a newer release, while
// Settings › General › Check for updates is on.
//   On Windows (the NSIS installer) and Linux (the AppImage), electron-
//   updater downloads it in the background and installs it when EarBee
//   quits ("install"). On a Mac, which can't update itself (not signed by
//   Apple), and on Linux run any other way than as the AppImage, the page
//   only says there is one, with a link to it ("notice").
//   The page shows either as a pill in the top bar (src/features/updates.js),
//   from the state sent on "updates:state": null, { kind: "ready", version }
//   or { kind: "available", version, url }. "updates:restart" closes the
//   windows (each asks about unsaved work, as when quitting) and then
//   installs and starts the new version; "updates:open" opens the release.
//
//   updateMode({ platform, isAppImage, packaged })  "install" | "notice" | "off"
//   isNewer(latest, current)                        whether a version is newer
//   handleUpdates(ipc, options)                     starts checking; returns
//                                                   { restartPending, restart }
//
// Where releases are: package.json's build.publish (electron-updater reads
// it from the app-update.yml electron-builder puts in the app); RELEASES
// below for the notice. Playback is king: this is only a little network
// traffic in the main process, and an update installs after EarBee quits.

// The latest published release (GitHub leaves drafts and prereleases out).
// EARBEE_UPDATES_URL replaces it, for trying the notice on a local file.
const RELEASES = "https://api.github.com/repos/wiktor-rocks/earbee/releases/latest";
// The first check a while after starting, then every few hours.
const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * How this copy of EarBee is updated.
 * @param {{ platform: string, isAppImage: boolean, packaged: boolean }} where
 * @returns {"install" | "notice" | "off"}
 */
function updateMode({ platform, isAppImage, packaged }) {
  if (!packaged) return "off"; // npm start and the tests never ask
  if (platform === "win32" || (platform === "linux" && isAppImage)) return "install";
  return "notice";
}

/** "0.3.1" or "v0.3.1" as numbers, or null. @param {unknown} version */
function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? "").trim());
  return match ? match.slice(1).map(Number) : null;
}

/** Whether `latest` is a newer version than `current` (prereleases never are). */
function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  const i = a.findIndex((part, index) => part !== b[index]);
  return i >= 0 && a[i] > b[i];
}

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {object} options
 * @param {{ get: (id: string) => Record<string, any>, onChange: (fn: (section: string) => void) => void }} options.prefs
 * @param {string} options.version This EarBee's.
 * @param {"install" | "notice" | "off"} options.mode
 * @param {() => Electron.WebContents[]} options.pages The windows to tell.
 * @param {typeof globalThis.fetch} options.fetch
 * @param {(url: string) => void} options.openExternal
 * @param {() => Electron.BrowserWindow[]} options.windows Every window, closed for a restart.
 */
function handleUpdates(ipcMain, { prefs, version, mode, pages, fetch, openExternal, windows }) {
  /** @type {null | { kind: "ready", version: string } | { kind: "available", version: string, url: string }} */
  let state = null;
  let timer = null;
  let restartPending = false;
  /** @type {any} */
  let updater = null;

  const send = (next) => {
    state = next;
    for (const page of pages()) page.send("updates:state", state);
  };

  // electron-updater only where it installs: loading it elsewhere is
  // wasted time at startup.
  function installer() {
    if (updater) return updater;
    updater = require("electron-updater").autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.logger = console;
    updater.on("update-downloaded", (info) => send({ kind: "ready", version: info.version }));
    // Offline, or the AppImage's folder can't be written: try again later.
    updater.on("error", (error) => console.warn("Update check failed:", error?.message ?? error));
    return updater;
  }

  async function checkForNotice() {
    const response = await fetch(process.env.EARBEE_UPDATES_URL || RELEASES, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const release = await response.json();
    if (isNewer(release.tag_name, version))
      send({ kind: "available", version: String(release.tag_name).replace(/^v/, ""), url: release.html_url });
  }

  async function check() {
    if (state?.kind === "ready") return; // one is waiting to be installed
    try {
      if (mode === "install") await installer().checkForUpdates();
      else await checkForNotice();
    } catch (error) {
      console.warn("Update check failed:", error?.message ?? error);
    }
  }

  // Checking follows the setting: on, a check soon and then every few
  // hours; off, no more checks (a download already going finishes).
  function follow() {
    const on = mode !== "off" && prefs.get("general").checkUpdates;
    if (on && !timer) {
      timer = setTimeout(function next() {
        check();
        timer = setTimeout(next, CHECK_EVERY_MS);
      }, FIRST_CHECK_MS);
    } else if (!on && timer) {
      clearTimeout(timer);
      timer = null;
    }
  }
  follow();
  prefs.onChange((section) => section === "general" && follow());

  ipcMain.handle("updates:state", () => state);
  ipcMain.on("updates:open", () => {
    if (state?.kind === "available" && /^https:\/\/github\.com\//.test(state.url)) openExternal(state.url);
  });
  // Every window is closed first, each asking about unsaved work as when
  // quitting; once they're all gone, main.js calls restart().
  ipcMain.on("updates:restart", () => {
    if (state?.kind !== "ready") return;
    restartPending = true;
    for (const win of windows()) win.close();
  });

  return {
    restartPending: () => restartPending,
    // Installs the downloaded update and starts the new EarBee.
    restart: () => installer().quitAndInstall(true, true),
  };
}

module.exports = { updateMode, isNewer, handleUpdates };
