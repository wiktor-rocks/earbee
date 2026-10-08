// The window's size, position and maximised state, kept between runs in
// window-state.json in the user-data folder.
const { app, screen } = require("electron");
const fs = require("fs");
const path = require("path");

const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

// The saved bounds, if they are sane and still on a connected display
// (a monitor may have been unplugged since); otherwise `defaults`.
function loadWindowState(minSize, defaults) {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
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
    };
  } catch {
    return defaults; // first run, or an unreadable file
  }
}

function saveWindowState(state) {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(state));
  } catch (error) {
    console.warn("Couldn't save the window state:", error);
  }
}

// Tracks `win`'s bounds as they change and saves them once it is gone.
// ("close" alone isn't enough: it doesn't fire when the page itself closes
// the window.)
function rememberWindowState(win) {
  let state = { ...win.getNormalBounds(), maximized: false };
  const remember = () => {
    if (!win.isDestroyed()) state = { ...win.getNormalBounds(), maximized: win.isMaximized() };
  };
  for (const event of ["resize", "move", "maximize", "unmaximize", "close"]) win.on(event, remember);
  win.on("closed", () => saveWindowState(state));
}

module.exports = { loadWindowState, rememberWindowState };
