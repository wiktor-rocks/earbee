// Electron main process: one window showing index.html.
//
//   Security   The page runs sandboxed with context isolation and no Node
//              access; it may not navigate away or open other windows.
//              Its Content-Security-Policy is in index.html.
//   Downloads  The page's one bridge out (preload.js): downloading a link
//              with yt-dlp, done here in downloader.js.
//   Window     Remembers its size, position and maximised state between
//              runs (window-state.json in the user-data folder). The title
//              follows the page's <title>, which names the open file.
//   GPU        Chromium picks the GPU itself and falls back to software
//              rendering if the GPU process keeps crashing.
//              `npm run start:no-gpu` forces software rendering;
//              `npm run start:gpu-info` logs what the GPU is doing.
const { app, BrowserWindow, ipcMain, net, screen } = require("electron");
const fs = require("fs");
const path = require("path");
const { handleDownloads } = require("./downloader");

const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;
const DEFAULT_BOUNDS = { width: 1200, height: 800 };

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
  require("electron-reload")(__dirname, {
    electron: require(`${__dirname}/node_modules/electron`),
  });
}

/* ---------- Window state ---------- */

const windowStateFile = () => path.join(app.getPath("userData"), "window-state.json");

// The saved bounds, if they are sane and still on a connected display
// (a monitor may have been unplugged since); otherwise the defaults.
function loadWindowState() {
  try {
    const saved = JSON.parse(fs.readFileSync(windowStateFile(), "utf8"));
    const { x, y, width, height } = saved;
    if (![x, y, width, height].every(Number.isFinite)) return DEFAULT_BOUNDS;

    const visible = screen.getAllDisplays().some(({ workArea: area }) => {
      const overlapX = Math.min(x + width, area.x + area.width) - Math.max(x, area.x);
      const overlapY = Math.min(y + height, area.y + area.height) - Math.max(y, area.y);
      return overlapX >= 100 && overlapY >= 100;
    });
    if (!visible) return DEFAULT_BOUNDS;

    return {
      x,
      y,
      width: Math.max(width, MIN_WIDTH),
      height: Math.max(height, MIN_HEIGHT),
      maximized: saved.maximized === true,
    };
  } catch {
    return DEFAULT_BOUNDS; // first run, or an unreadable file
  }
}

function saveWindowState(state) {
  try {
    fs.mkdirSync(path.dirname(windowStateFile()), { recursive: true });
    fs.writeFileSync(windowStateFile(), JSON.stringify(state));
  } catch (error) {
    console.warn("Couldn't save the window state:", error);
  }
}

/* ---------- Window ---------- */

function createWindow() {
  const { maximized, ...bounds } = loadWindowState();
  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: "TranscriBee",
    icon: path.join(__dirname, "assets", "icon-512.png"),
    backgroundColor: "#0e1014", // the page background, so opening doesn't flash white
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

  // Remember the bounds as they change, and write them once the window is
  // gone. ("close" alone isn't enough: it doesn't fire when the page itself
  // closes the window.)
  let state = { ...win.getNormalBounds(), maximized: false };
  const remember = () => {
    if (!win.isDestroyed()) state = { ...win.getNormalBounds(), maximized: win.isMaximized() };
  };
  for (const event of ["resize", "move", "maximize", "unmaximize", "close"]) win.on(event, remember);
  win.on("closed", () => saveWindowState(state));
  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  handleDownloads(ipcMain, {
    binDir: path.join(app.getPath("userData"), "bin"),
    saveDir: path.join(app.getPath("downloads"), "TranscriBee"),
    fetch: net.fetch, // follows the system's proxy settings
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
