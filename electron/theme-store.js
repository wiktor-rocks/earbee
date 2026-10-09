// The colour theme on the main-process side, read from the settings
// (prefs-store.js, section "theme"): which theme shows now, the colours the
// preload applies before the page renders, and the window background, kept
// in step so opening never flashes another colour.
//
// The themes themselves are the page's (src/themes, ES modules), loaded
// here with require().
const themes = require("../src/themes/index.js");

/**
 * @param {ReturnType<typeof import("./prefs-store.js").createPrefsStore>} store
 * @param {{ shouldUseDarkColors: boolean }} system Electron's nativeTheme.
 */
function createThemeView(store, system) {
  // The theme showing now ("auto" depends on the system's dark mode).
  const current = () => themes.resolveTheme(store.get("theme"), system.shouldUseDarkColors);
  return {
    current,
    // For the preload, before the page renders.
    initial() {
      const theme = current();
      return { scheme: theme.scheme, variables: themes.cssVariables(theme) };
    },
  };
}

module.exports = { createThemeView };
