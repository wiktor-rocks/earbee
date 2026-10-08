// Electron main process: one window showing index.html.
//
//   Security   The page runs sandboxed with context isolation and no Node
//              access; it may not navigate away or open other windows.
//              Its Content-Security-Policy is in index.html.
//   Downloads  Through the page's bridge (preload.js): downloading a link
//              with yt-dlp, done here in downloader.js. The page reads the
//              saved file by a private URL (media-files.js), in pieces.
//   System     The memory available for a track (system.js); if the page's
//              process dies, a message and a reload instead of a blank
//              window.
//   Theme      The chosen colour theme (theme-store.js): applied by the
//              preload before the page renders, and the window background.
//   Window     Remembers its size, position and maximised state between
//              runs (window-state.js). The title follows the page's
//              <title>, which names the open file.
//   GPU        Chromium picks the GPU itself and falls back to software
//              rendering if the GPU process keeps crashing.
//              `npm run start:no-gpu` forces software rendering;
//              `npm run start:gpu-info` logs what the GPU is doing.
const { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol } = require("electron");
const path = require("path");
const { handleDownloads } = require("./downloader");
const { createMediaFiles, registerMediaScheme } = require("./media-files");
const { handleRendererCrash, handleSystem } = require("./system");
const { createThemeStore, handleThemes } = require("./theme-store");
const { loadWindowState, rememberWindowState } = require("./window-state");

const ROOT = path.join(__dirname, ".."); // the app's files: index.html, src/, assets/

const MIN_SIZE = { width: 900, height: 640 };
const DEFAULT_BOUNDS = { width: 1200, height: 800 };

registerMediaScheme(protocol); // must happen before the app is ready

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

// Development only: reload the window when a source file changes.
if (!app.isPackaged) {
  require("electron-reload")(ROOT, {
    electron: require(path.join(ROOT, "node_modules", "electron")),
  });
}

/* ---------- Window ---------- */

let themeStore = null; // set once the app is ready

function createWindow() {
  const { maximized, ...bounds } = loadWindowState(MIN_SIZE, DEFAULT_BOUNDS);
  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: "TranscriBee",
    icon: path.join(ROOT, "assets", "icon-512.png"),
    backgroundColor: themeStore.current().colors.bg, // the page background, so opening doesn't flash
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (maximized) win.maximize();

  // The page never navigates or opens windows; a dropped file or a stray
  // link must not replace the app.
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  rememberWindowState(win);
  handleRendererCrash(win, dialog);
  win.loadFile(path.join(ROOT, "index.html"));
}

app.whenReady().then(() => {
  themeStore = createThemeStore(path.join(app.getPath("userData"), "theme.json"), nativeTheme);
  const followTheme = () => {
    for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(themeStore.current().colors.bg);
  };
  handleThemes(ipcMain, themeStore, followTheme);
  handleSystem(ipcMain);
  nativeTheme.on("updated", followTheme); // "Automatic" follows the system
  const mediaFiles = createMediaFiles();
  mediaFiles.handle(protocol);
  handleDownloads(ipcMain, {
    binDir: path.join(app.getPath("userData"), "bin"),
    saveDir: path.join(app.getPath("downloads"), "TranscriBee"),
    fetch: net.fetch, // follows the system's proxy settings
    share: mediaFiles.share,
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
