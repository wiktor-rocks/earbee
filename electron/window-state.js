// A window's size, position, maximised and always-on-top state, kept
// between runs in <name>.json in the user-data folder (window-state.json
// for the main window).
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

module.exports = { loadWindowState, rememberWindowState };
