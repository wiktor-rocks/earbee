// Electron main process: one window showing index.html.
//
//   Security   The page runs sandboxed with context isolation and no Node
//              access; it may not navigate away or open other windows.
//              Its Content-Security-Policy is in index.html.
//              Video window (src/features/video-window/): the one window
//              it may open, for the video's picture (windows.js).
//   Downloads  Through the page's bridge (preload.js): downloading a link
//              with yt-dlp, or searching by keywords, done here in
//              downloader.js; a result can be opened in the browser. The page reads the
//              saved file by a private URL (media-files.js), in pieces.
//   System     The memory available for a track (system.js); if the page's
//              process dies, a message and a reload instead of a blank
//              window.
//   Beats      The beat model, run for the page in a utility process
//              (beat-model.js) on the native ONNX Runtime.
//   Settings   The user's preferences (prefs-store.js, prefs.json): read
//              and changed by the page's Settings dialog through the
//              preload; the folder picker is here. The colour theme
//              (also prefs-store.js) is one section: applied by the preload
//              before the page renders, and the window background.
//              Downloads read theirs for each download.
//   Projects   EarBee files (.ebee) with a session's marks and
//              settings (project-files.js): opened and saved through the
//              preload, with the native dialogs below. Closing the window
//              with unsaved changes asks first (guardClose).
//   Window     Remembers its size, position and maximised state between
//              runs (windows.js). The title follows the page's
//              <title>, which names the open file. While the page loads,
//              hidden, a splash shows the bee and a loader (windows.js).
//   GPU        Chromium picks the GPU itself and falls back to software
//              rendering if the GPU process keeps crashing.
//              `npm run start:no-gpu` forces software rendering;
//              `npm run start:gpu-info` logs what the GPU is doing.
const { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, shell, utilityProcess } = require("electron");
const fs = require("fs");
const path = require("path");
const { handleBeatModel } = require("./beat-model");
const { handleDownloads } = require("./downloader");
const { createMediaFiles, registerMediaScheme } = require("./media-files");
const { handleRendererCrash, handleSystem } = require("./system");
const { createPrefsStore, createThemeView, handlePrefs } = require("./prefs-store");
const { createProjectFiles, guardClose, handleProjects } = require("./project-files");
const { handleSplash, loadWindowState, rememberWindowState, showAfterSplash } = require("./windows");
const { allowVideoWindow, handleVideoWindows } = require("./windows"); // Video window (src/features/video-window/)

const ROOT = path.join(__dirname, ".."); // the app's files: index.html, src/, assets/

const MIN_SIZE = { width: 900, height: 640 };
const DEFAULT_BOUNDS = { width: 1200, height: 800 };

registerMediaScheme(protocol); // must happen before the app is ready

// The app was called ScriBee until 0.1.1: once, on a start under its
// new name, its settings folder (prefs.json, the window states, the
// page's storage) comes along, over whatever a first start already made
// there (nothing has opened those files yet: the app isn't ready). A
// copy, so going back to an older version still works; a marker file
// says it's done. The old theme ids are translated by prefs-store.js,
// the page's old storage keys where the page reads them.
function adoptOldSettings() {
  const current = app.getPath("userData");
  const old = path.join(app.getPath("appData"), "ScriBee");
  const marker = path.join(current, "adopted-scribee-settings");
  // Not for a folder given on the command line (the smoke test's profile).
  if (app.commandLine.hasSwitch("user-data-dir")) return;
  if (!fs.existsSync(old) || fs.existsSync(marker)) return;
  try {
    fs.cpSync(old, current, { recursive: true, force: true });
    fs.writeFileSync(marker, "");
  } catch (error) {
    console.warn("Couldn't copy the settings from ScriBee:", error);
  }
}
adoptOldSettings();

app.on("child-process-gone", (_event, details) => {
  if (details.type === "GPU") {
    console.warn(`GPU process gone: ${details.reason} (exit code ${details.exitCode})`);
  }
});

async function logGpuInfo() {
  const info = await app.getGPUInfo("basic");
  const activeGpu = info.gpuDevice?.find((device) => device.active);
  console.log("GPU features:", app.getGPUFeatureStatus());
  console.log("Active GPU:", activeGpu ?? info.gpuDevice);
}

// Development only: reload the window when a source file changes. Not for
// what tests, builds and the landing page write or hold (this replaces
// electron-reload's own list, so node_modules and dotfiles are repeated).
if (!app.isPackaged) {
  require("electron-reload")(ROOT, {
    electron: require(path.join(ROOT, "node_modules", "electron")),
    ignored: [/node_modules|[/\\]\./, /[/\\](dist|site|tests[/\\](output|fixtures))([/\\]|$)/],
  });
}

/* ---------- Window ---------- */

let themeView = null; // set once the app is ready
const projectState = new Map(); // each page's unsaved changes (project-files.js)

// The native dialogs for project files, over the window that asked.
const owner = (sender) => BrowserWindow.fromWebContents(sender);
const withOwner = (sender, show, options) => (owner(sender) ? show(owner(sender), options) : show(options));
const PROJECT_FILTERS = [{ name: "EarBee projects", extensions: ["ebee"] }];
const projectDialogs = {
  async save(sender, defaultPath) {
    const { canceled, filePath } = await withOwner(sender, dialog.showSaveDialog, {
      title: "Save project",
      defaultPath,
      filters: PROJECT_FILTERS,
      properties: ["showOverwriteConfirmation", "createDirectory"],
    });
    return canceled || !filePath ? null : filePath;
  },
  async locate(sender, name, defaultPath) {
    const { canceled, filePaths } = await withOwner(sender, dialog.showOpenDialog, {
      title: `Where is “${name}”?`,
      message: `The project's song or video, “${name}”, isn't where it was. Where is it now?`,
      defaultPath,
      properties: ["openFile"],
    });
    return canceled || !filePaths.length ? null : filePaths[0];
  },
  async confirm(sender, name) {
    const { response } = await withOwner(sender, dialog.showMessageBox, {
      type: "warning",
      message: name ? `Save the changes to “${name}”?` : "Save this session as a project?",
      detail: "Your marks and settings are lost if you don't save them.",
      buttons: ["Save…", "Don't save", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    return /** @type {const} */ (["save", "discard", "cancel"])[response] ?? "cancel";
  },
};

// The app's own windows (not the video window, which stays black).
const mainWindows = new Set();

function createWindow() {
  // (The saved state also has the video window's alwaysOnTop: not for this one.)
  const { x, y, width, height, maximized } = loadWindowState(MIN_SIZE, DEFAULT_BOUNDS);
  const icon = path.join(ROOT, "assets", "icon-512.png");
  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: "EarBee",
    icon,
    show: false, // until the page is ready; a splash shows meanwhile (showAfterSplash, below)
    backgroundColor: themeView.current().colors.bg, // the page background, so opening doesn't flash
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // No menu bar: everything is in the page. (Linux and Windows; a Mac's
  // menu is the system's, at the top of the screen, and stays.)
  win.removeMenu();
  mainWindows.add(win);
  win.on("closed", () => mainWindows.delete(win));

  // The page never navigates or opens windows; a dropped file or a stray
  // link must not replace the app.
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  allowVideoWindow(win, { icon }); // Video window (src/features/video-window/); else deny all: setWindowOpenHandler(() => ({ action: "deny" }))

  rememberWindowState(win);
  // Before handleRendererCrash: its dialog needs the window shown.
  showAfterSplash(win, { around: { x, y, width, height }, colors: themeView.current().colors, icon, maximized });
  guardClose(win, { ipcMain, dialogs: projectDialogs, state: projectState });
  handleRendererCrash(win, dialog);
  win.loadFile(path.join(ROOT, "index.html"));
}

app.whenReady().then(() => {
  const userData = app.getPath("userData");
  const downloadsFolder = path.join(app.getPath("downloads"), "EarBee");
  const prefsStore = createPrefsStore(path.join(userData, "prefs.json"), {
    legacyThemeFile: path.join(userData, "theme.json"),
  });
  themeView = createThemeView(prefsStore, nativeTheme);
  const followTheme = () => {
    for (const win of mainWindows) win.setBackgroundColor(themeView.current().colors.bg);
  };
  handlePrefs(ipcMain, prefsStore, {
    initialTheme: themeView.initial,
    defaultPaths: { "downloads.folder": downloadsFolder },
    async chooseFolder(sender, defaultPath) {
      const { canceled, filePaths } = await withOwner(sender, dialog.showOpenDialog, {
        defaultPath,
        properties: ["openDirectory", "createDirectory"],
      });
      return canceled || !filePaths.length ? null : filePaths[0];
    },
    pages: () => BrowserWindow.getAllWindows().map((win) => win.webContents),
  });
  prefsStore.onChange((section) => section === "theme" && followTheme());
  handleSystem(ipcMain);
  handleBeatModel(ipcMain, { utilityProcess });
  handleSplash(ipcMain);
  handleVideoWindows(ipcMain); // Video window (src/features/video-window/)
  nativeTheme.on("updated", followTheme); // "Automatic" follows the system
  const mediaFiles = createMediaFiles();
  mediaFiles.handle(protocol);
  const projectFiles = createProjectFiles({ mediaFiles, dialogs: projectDialogs, appVersion: app.getVersion() });
  handleProjects(ipcMain, projectFiles, { mediaFiles, dialogs: projectDialogs, state: projectState });
  handleDownloads(ipcMain, {
    binDir: path.join(userData, "bin"),
    saveDir: downloadsFolder,
    prefs: () => prefsStore.get("downloads"),
    fetch: net.fetch, // follows the system's proxy settings
    share: mediaFiles.share,
    // A search result, in the browser (no browser: just a warning).
    openExternal: (url) => shell.openExternal(url).catch((error) => console.warn("Couldn't open the link:", error)),
  });
  createWindow();

  if (app.commandLine.hasSwitch("gpu-info")) {
    logGpuInfo().catch((error) => console.error("Couldn't read GPU info:", error));
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
