// The video window (src/features/video-window/): the page may open one
// window of its own, an empty same-origin page that it fills with the
// video's picture. Every other window.open is still denied, and the video
// window itself can't navigate or open windows.
//
//   Lifetime   It closes with its page (and if the page's process dies,
//              which is its process too), so closing the main window
//              still quits the app; a canceled close (guardClose) leaves it.
//   State      Its size, position and "always on top" are kept between
//              runs in video-window-state.json (window-state.js); the page
//              turns "always on top" on and off through the preload.
//
// Self-contained: removing the feature means deleting this file, its
// lines marked "Video window (" in main.js and preload.js, and putting
// back main.js's `setWindowOpenHandler(() => ({ action: "deny" }))`.
const { loadWindowState, rememberWindowState } = require("./window-state");

const FRAME_NAME = "transcribee-video"; // the page's window.open name
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
        autoHideMenuBar: true,
        ...extraOptions,
      },
    };
  });

  contents.on("did-create-window", (child) => {
    videoWindows.set(id, child);
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

module.exports = { allowVideoWindow, handleVideoWindows };
