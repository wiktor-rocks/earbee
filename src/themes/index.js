// Colour themes: the list, the colour roles every theme defines, and the
// pure logic around them (which theme applies, the CSS variables it sets,
// contrast). No DOM: the page applies themes in ui/theme.js, and the main
// process uses this file too, for the window background
// (electron/prefs-store.js).
//
// The themes themselves are in palettes.js (a new theme goes there). The
// marks' colours (MARK_COLORS, below) are shared by every theme.
import { THEMES } from "./palettes.js";

export { THEMES };

// The colours a mark on the waveform can have (see src/marks). Unlike a
// theme's roles they're the same in every theme, with one shade for dark
// themes and one for light ones; cssVariables() sets them as --mark-<id>.
// The unit tests check each is visible on every theme.

/** @typedef {{ id: string, name: string, dark: string, light: string }} MarkColor */

/** @type {MarkColor[]} */
export const MARK_COLORS = [
  { id: "rose", name: "Rose", dark: "#ff7aa2", light: "#c2185b" },
  { id: "orange", name: "Orange", dark: "#ff9f43", light: "#b35400" },
  { id: "green", name: "Green", dark: "#5fd38d", light: "#2e7d32" },
  { id: "blue", name: "Blue", dark: "#6ea8ff", light: "#1f5fbf" },
  { id: "violet", name: "Violet", dark: "#b88cff", light: "#7b3fbf" },
  { id: "grey", name: "Grey", dark: "#aab2c0", light: "#5f6673" },
];

export const DEFAULT_MARK_COLOR = MARK_COLORS[0].id;

/** @param {string} id */
const markColorVariable = (id) => `--mark-${id}`;

/**
 * @typedef {object} Theme
 * @property {string} id
 * @property {string} name
 * @property {"dark" | "light"} scheme
 * @property {Record<string, string>} colors One "#rrggbb" per role (see ROLES).
 */

/**
 * @typedef {object} ThemePrefs What the user chose.
 * @property {string} choice A theme id, or "auto" to follow the system.
 * @property {string} dark The theme "auto" uses in dark mode (the last dark one chosen).
 * @property {string} light The theme "auto" uses in light mode.
 */

// EarBee, and EarBee Light for Automatic in light mode.
const DEFAULT_THEME = THEMES.find((theme) => theme.id === "earbee");

/** @type {ThemePrefs} */
export const DEFAULT_PREFS = { choice: DEFAULT_THEME.id, dark: DEFAULT_THEME.id, light: "earbee-light" };

// Each role and the CSS variable it sets. Optional roles are derived from
// the others when a theme leaves them out (see DERIVED).
export const ROLES = {
  bg: "--bg", // window background
  surface: "--surface", // panels, the waveform
  surface2: "--surface-2", // buttons, inputs
  border: "--border",
  text: "--text",
  muted: "--muted", // labels, hints
  accent: "--accent", // played waveform, primary buttons, focus
  accentInk: "--accent-ink", // text on the accent
  danger: "--danger", // errors
  loop: "--loop", // the A–B loop; must stand out from the accent
  wave: "--wave", // the waveform not yet played
  cursor: "--cursor", // the playback cursor
  start: "--start", // optional; where Space plays from (green, apart from the loop and accent)
  stop: "--stop", // optional; where playback last stopped (red, apart from the loop, accent and start)
  surfaceHover: "--surface-hover", // optional
  accentHover: "--accent-hover", // optional
  minimapWave: "--minimap-wave", // optional
  minimapProgress: "--minimap-progress", // optional
};

/** @type {Record<string, (colors: Record<string, string>, scheme: string) => string>} */
const DERIVED = {
  surfaceHover: (c) => mix(c.surface2, c.text, 0.08),
  accentHover: (c, scheme) => mix(c.accent, scheme === "dark" ? "#ffffff" : "#000000", 0.15),
  minimapWave: (c) => mix(c.wave, c.surface, 0.15),
  minimapProgress: (c) => mix(c.accent, c.surface, 0.45),
  // The marks' green, in the shade for the scheme.
  start: (c, scheme) => MARK_COLORS.find((color) => color.id === "green")[scheme],
  // The error red.
  stop: (c) => c.danger,
};

export const REQUIRED_ROLES = Object.keys(ROLES).filter((role) => !(role in DERIVED));

/** @param {string | undefined} id */
export const getTheme = (id) => THEMES.find((theme) => theme.id === id) ?? DEFAULT_THEME;

/**
 * The theme to show for `prefs`, given whether the system is in dark mode.
 * @param {Partial<ThemePrefs> | null | undefined} prefs
 * @param {boolean} prefersDark
 */
export function resolveTheme(prefs, prefersDark) {
  const { choice, dark, light } = { ...DEFAULT_PREFS, ...prefs };
  if (choice !== "auto") return getTheme(choice);
  const wanted = getTheme(prefersDark ? dark : light);
  // A pairing that no longer matches its scheme falls back to the defaults.
  if (wanted.scheme === (prefersDark ? "dark" : "light")) return wanted;
  return getTheme(prefersDark ? DEFAULT_PREFS.dark : DEFAULT_PREFS.light);
}

/**
 * Every CSS variable the theme sets, as literal colours (the waveform
 * draws on a canvas, which can't resolve var() or color-mix()).
 * @param {Theme} theme
 * @returns {Record<string, string>}
 */
export function cssVariables(theme) {
  const colors = { ...theme.colors };
  for (const [role, derive] of Object.entries(DERIVED)) colors[role] ??= derive(colors, theme.scheme);
  return {
    ...Object.fromEntries(Object.entries(ROLES).map(([role, variable]) => [variable, colors[role]])),
    // The marks' colours, in the shade for the theme's scheme.
    ...Object.fromEntries(MARK_COLORS.map((color) => [markColorVariable(color.id), color[theme.scheme]])),
  };
}

/* ---------- Colour maths ---------- */

/** @param {string} hex "#rrggbb" */
export function parseHex(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const toHex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

/** `a` moved toward `b` by `amount` (0–1), in sRGB. */
const mix = (a, b, amount) => {
  const [from, to] = [parseHex(a), parseHex(b)];
  return toHex(from.map((c, i) => c + (to[i] - c) * amount));
};

// WCAG relative luminance and contrast ratio (1–21).
const luminance = (hex) => {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** @param {string} a @param {string} b */
export function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
