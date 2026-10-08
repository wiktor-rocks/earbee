// Applies colour themes to the page: sets the theme's CSS variables on
// <html>, which everything styled with them follows at once. Canvas
// drawings (the waveform) don't, so they listen with onThemeChange().
//
// The preload has usually applied the saved theme already, before the
// page rendered (no flash); applying it again here is harmless and makes
// the page work without the preload too.
import { cssVariables, normalizePrefs, resolveTheme } from "../themes/index.js";

/** @typedef {import("../themes/index.js").Theme} Theme */
/** @typedef {import("../themes/index.js").ThemePrefs} ThemePrefs */

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
/** @type {Set<(theme: Theme) => void>} */
const listeners = new Set();

/** @type {ThemePrefs} */
let prefs = normalizePrefs(null);
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

const applyPrefs = () => apply(resolveTheme(prefs, darkQuery.matches));

/**
 * Shows the theme `next` asks for (unknown ids become the defaults).
 * @param {unknown} next
 */
export function setThemePrefs(next) {
  prefs = normalizePrefs(next);
  applyPrefs();
}

export const getThemePrefs = () => prefs;
export const currentTheme = () => current;

/** @param {(theme: Theme) => void} listener Called after the theme changed. */
export function onThemeChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// "Automatic" follows the system's dark / light setting as it changes.
darkQuery.addEventListener("change", () => {
  if (prefs.choice === "auto") applyPrefs();
});
