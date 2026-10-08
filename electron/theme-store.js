// The colour theme on the main-process side: remembers the user's choice
// (theme.json in the user-data folder), tells the preload which colours to
// apply before the page renders, and keeps the window background in step
// so opening never flashes another colour.
//
// The themes themselves are the page's (src/themes, ES modules), loaded
// here with require().
const fs = require("fs");
const path = require("path");
const themes = require("../src/themes/index.js");

/**
 * @param {string} file Where the choice is saved.
 * @param {{ shouldUseDarkColors: boolean }} system Electron's nativeTheme.
 */
function createThemeStore(file, system) {
  let prefs = load();

  function load() {
    try {
      return themes.normalizePrefs(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      return themes.normalizePrefs(null); // first run, or an unreadable file
    }
  }

  return {
    prefs: () => prefs,
    // The theme showing now ("auto" depends on the system's dark mode).
    current: () => themes.resolveTheme(prefs, system.shouldUseDarkColors),
    save(next) {
      prefs = themes.normalizePrefs(next);
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(prefs));
      } catch (error) {
        console.warn("Couldn't save the theme:", error);
      }
    },
  };
}

/**
 * Answers the preload (see preload.js): the theme to apply at startup, and
 * saving a new choice. Must be registered before any window is created:
 * the preload asks synchronously while the page starts.
 * @param {import("electron").IpcMain} ipcMain
 * @param {ReturnType<typeof createThemeStore>} store
 * @param {(theme: import("../src/themes/index.js").Theme) => void} onChange
 */
function handleThemes(ipcMain, store, onChange) {
  // The preload waits for this answer (sendSync), so it must always get one.
  ipcMain.on("theme:initial", (event) => {
    try {
      const theme = store.current();
      event.returnValue = { prefs: store.prefs(), scheme: theme.scheme, variables: themes.cssVariables(theme) };
    } catch (error) {
      console.warn("Couldn't read the theme:", error);
      event.returnValue = null; // the page falls back to the default theme
    }
  });
  ipcMain.handle("theme:save", (_event, next) => {
    store.save(next);
    onChange(store.current());
  });
}

module.exports = { createThemeStore, handleThemes };
