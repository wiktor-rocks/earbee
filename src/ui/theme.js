// Applies colour themes to the page: sets the theme's CSS variables on
// <html>, which everything styled with them follows at once. Canvas
// drawings (the waveform) don't, so they listen with onThemeChange().
//
// Which theme comes from the settings (section "theme", see
// src/prefs/sections/theme.js); this follows them, whoever changes them.
// The preload has usually applied the saved theme already, before the
// page rendered (no flash); applying it again here is harmless and makes
// the page work without the preload too.
import { cssVariables, resolveTheme } from "../themes/index.js";
import { getPrefs, onPrefsChange } from "./prefs.js";

/** @typedef {import("../themes/index.js").Theme} Theme */
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
/** @type {Set<(theme: Theme) => void>} */
const listeners = new Set();

/** @type {Theme | null} */
let current = null;

/** @param {Theme} theme */
function apply(theme) {
  const root = document.documentElement;
  for (const [variable, value] of Object.entries(cssVariables(theme))) root.style.setProperty(variable, value);
  root.style.colorScheme = theme.scheme; // native controls and scrollbars
  root.dataset.theme = theme.id;
  const changed = current?.id !== theme.id;
  current = theme;
  if (changed) for (const listener of listeners) listener(theme);
}

const applyPrefs = () => apply(resolveTheme(getPrefs("theme"), darkQuery.matches));

/** Shows the chosen theme now, and from then on whenever the choice changes. */
export function followThemePrefs() {
  applyPrefs();
  onPrefsChange("theme", applyPrefs);
}

export const currentTheme = () => current;

/** @param {(theme: Theme) => void} listener Called after the theme changed. */
export function onThemeChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// "Automatic" follows the system's dark / light setting as it changes.
darkQuery.addEventListener("change", () => {
  if (getPrefs("theme").choice === "auto") applyPrefs();
});
