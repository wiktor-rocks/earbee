// The app's windows. First, a window's size, position, maximised and
// always-on-top state, kept between runs in <name>.json in the user-data
// folder (window-state.json for the main window). Then the splash, shown
// while the main window loads, and the video window, the one other window
// the page may open.
const { app, BrowserWindow, screen } = require("electron");
const fs = require("fs");
const path = require("path");

const stateFile = (name) => path.join(app.getPath("userData"), `${name}.json`);

// The saved bounds, if they are sane and still on a connected display
// (a monitor may have been unplugged since); otherwise `defaults`.
function loadWindowState(minSize, defaults, name = "window-state") {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(name), "utf8"));
    const { x, y, width, height } = saved;
    if (![x, y, width, height].every(Number.isFinite)) return defaults;

    const visible = screen.getAllDisplays().some(({ workArea: area }) => {
      const overlapX = Math.min(x + width, area.x + area.width) - Math.max(x, area.x);
      const overlapY = Math.min(y + height, area.y + area.height) - Math.max(y, area.y);
      return overlapX >= 100 && overlapY >= 100;
    });
    if (!visible) return defaults;

    return {
      x,
      y,
      width: Math.max(width, minSize.width),
      height: Math.max(height, minSize.height),
      maximized: saved.maximized === true,
      alwaysOnTop: saved.alwaysOnTop === true,
    };
  } catch {
    return defaults; // first run, or an unreadable file
  }
}

function saveWindowState(state, name) {
  try {
    fs.mkdirSync(path.dirname(stateFile(name)), { recursive: true });
    fs.writeFileSync(stateFile(name), JSON.stringify(state));
  } catch (error) {
    console.warn("Couldn't save the window state:", error);
  }
}

// Tracks `win`'s bounds as they change and saves them once it is gone.
// ("close" alone isn't enough: it doesn't fire when the page itself closes
// the window.)
function rememberWindowState(win, name = "window-state") {
  let state = { ...win.getNormalBounds(), maximized: false, alwaysOnTop: win.isAlwaysOnTop() };
  const remember = () => {
    if (!win.isDestroyed())
      state = { ...win.getNormalBounds(), maximized: win.isMaximized(), alwaysOnTop: win.isAlwaysOnTop() };
  };
  for (const event of ["resize", "move", "maximize", "unmaximize", "always-on-top-changed", "close"])
    win.on(event, remember);
  win.on("closed", () => saveWindowState(state, name));
}

/* ---------- The splash ---------- */

// A small window with the bee, the name and a loader (splash.html), shown
// while the main window loads hidden behind it, so a slow start doesn't
// look like an empty window.
//
//   Hand-over  The page says when it's ready (the preload's ready(), at the
//              end of start() in src/app.js); then the main window shows
//              and the splash closes, after the splash has been up for
//              MIN_SPLASH_MS, so a fast start doesn't blink. If the main
//              window is ready before the splash has even painted, the
//              splash never shows.
//   Fallbacks  The main window shows at once if its page fails to load or
//              its process dies (the crash dialog needs a window to sit
//              on), and after READY_TIMEOUT_MS if the page never says.
//   Closing    Closing the splash (Alt+F4) before then closes the main
//              window too, so the app quits.
const SPLASH_SIZE = { width: 360, height: 300 };
const MIN_SPLASH_MS = 600;
const READY_TIMEOUT_MS = 15000;

// Each main window still behind a splash: its reveal(), by its webContents id.
const waiting = new Map();

function handleSplash(ipcMain) {
  ipcMain.on("app:ready", (event) => waiting.get(event.sender.id)?.({ wait: true }));
}

// Opens a splash for `win`, which must have been made with show: false,
// and shows `win` when its page is ready (above). `around` is where `win`
// will be (the splash is centred on it; without x and y, on the screen);
// `colors` the theme's (bg, text, accent); `maximized` whether `win`
// opens maximised (maximize() shows a window, so it waits until then).
function showAfterSplash(win, { around, colors, icon, maximized = false }) {
  const { width, height } = SPLASH_SIZE;
  const position = Number.isFinite(around.x)
    ? {
        x: Math.round(around.x + (around.width - width) / 2),
        y: Math.round(around.y + (around.height - height) / 2),
      }
    : { center: true };
  const splash = new BrowserWindow({
    ...position,
    width,
    height,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: "ScriBee",
    icon,
    backgroundColor: colors.bg, // the theme's, so opening doesn't flash
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  splash.removeMenu();
  splash.webContents.on("will-navigate", (event) => event.preventDefault());
  splash.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  splash.loadFile(path.join(__dirname, "splash.html"), {
    query: { bg: colors.bg, text: colors.text, accent: colors.accent },
  });

  let shownAt = null; // when the splash appeared; null while it hasn't
  let revealed = false;
  splash.once("ready-to-show", () => {
    if (revealed) return;
    splash.show();
    shownAt = Date.now();
  });

  const id = win.webContents.id;
  const finish = () => {
    if (!win.isDestroyed()) {
      if (maximized) win.maximize();
      else win.show();
      win.focus();
    }
    if (!splash.isDestroyed()) splash.destroy();
  };
  const reveal = ({ wait = false } = {}) => {
    if (revealed) return;
    revealed = true;
    waiting.delete(id);
    clearTimeout(timeout);
    const left = wait && shownAt !== null ? MIN_SPLASH_MS - (Date.now() - shownAt) : 0;
    if (left > 0) setTimeout(finish, left);
    else finish();
  };
  waiting.set(id, reveal);

  const timeout = setTimeout(() => {
    console.warn("The page didn't say it was ready; showing it anyway.");
    reveal();
  }, READY_TIMEOUT_MS);
  win.webContents.on("did-fail-load", (_event, _code, _description, _url, isMainFrame) => isMainFrame && reveal());
  win.webContents.on("render-process-gone", () => reveal());

  splash.on("closed", () => {
    if (!revealed && !win.isDestroyed()) win.close();
  });
  win.on("closed", () => {
    revealed = true;
    waiting.delete(id);
    clearTimeout(timeout);
    if (!splash.isDestroyed()) splash.destroy();
  });
}

/* ---------- The video window ---------- */

// The video window (src/features/video-window/): the page may open one
// window of its own, an empty same-origin page that it fills with the
// video's picture. Every other window.open is still denied, and the video
// window itself can't navigate or open windows.
//
//   Lifetime   It closes with its page (and if the page's process dies,
//              which is its process too), so closing the main window
//              still quits the app; a canceled close (guardClose) leaves it.
//   State      Its size, position and "always on top" are kept between
//              runs in video-window-state.json (as above); the page
//              turns "always on top" on and off through the preload.
//
// Self-contained: removing the feature means deleting this part, its
// lines marked "Video window (" (main.js, preload.js, src/app.js and the
// tests: run.cjs, smoke.cjs, e2e/harness.cjs, 01-static-ui.cjs, and
// 18-video-window.cjs whole), and putting back main.js's
// `setWindowOpenHandler(() => ({ action: "deny" }))`.
const FRAME_NAME = "scribee-video"; // the page's window.open name
const STATE_NAME = "video-window-state";
const MIN_SIZE = { width: 240, height: 135 };
const DEFAULT_BOUNDS = { width: 640, height: 360 };

// Each page's video window, by the page's webContents id.
const videoWindows = new Map();

// The page asks for, or sets, "always on top" (a boolean `on`) of its video
// window; the answer is the state now (false without a window).
function handleVideoWindows(ipcMain) {
  ipcMain.handle("video-window:always-on-top", (event, on) => {
    const child = videoWindows.get(event.sender.id);
    if (!child || child.isDestroyed()) return false;
    if (typeof on === "boolean") child.setAlwaysOnTop(on);
    return child.isAlwaysOnTop();
  });
}

// Lets `win`'s page open its video window. `extraOptions` are added to the
// window's options (the tests make it offscreen).
function allowVideoWindow(win, { icon, extraOptions = {} } = {}) {
  const contents = win.webContents;
  const id = contents.id;

  contents.setWindowOpenHandler(({ url, frameName }) => {
    if (url !== "about:blank" || frameName !== FRAME_NAME || videoWindows.has(id)) return { action: "deny" };
    const { x, y, width, height, alwaysOnTop } = loadWindowState(MIN_SIZE, DEFAULT_BOUNDS, STATE_NAME);
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        x,
        y,
        width,
        height,
        alwaysOnTop: alwaysOnTop === true,
        minWidth: MIN_SIZE.width,
        minHeight: MIN_SIZE.height,
        title: "Video",
        icon,
        backgroundColor: "#000",
        ...extraOptions,
      },
    };
  });

  contents.on("did-create-window", (child) => {
    videoWindows.set(id, child);
    child.removeMenu(); // no menu bar, not even on Alt (as the main window)
    child.webContents.on("will-navigate", (event) => event.preventDefault());
    child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    rememberWindowState(child, STATE_NAME);
    child.on("closed", () => videoWindows.get(id) === child && videoWindows.delete(id));
  });

  const closeChild = (force) => {
    const child = videoWindows.get(id);
    if (!child || child.isDestroyed()) return;
    if (force) child.destroy();
    else child.close();
  };
  win.on("closed", () => closeChild(false));
  contents.on("render-process-gone", () => closeChild(true));
}

module.exports = {
  allowVideoWindow,
  handleSplash,
  handleVideoWindows,
  loadWindowState,
  rememberWindowState,
  showAfterSplash,
};
