// The app's windows. First, a window's size, position, maximised and
// always-on-top state, kept between runs in <name>.json in the user-data
// folder (window-state.json for the main window). Then the video window,
// the one other window the page may open.
const { app, screen } = require("electron");
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

module.exports = { allowVideoWindow, handleVideoWindows, loadWindowState, rememberWindowState };
